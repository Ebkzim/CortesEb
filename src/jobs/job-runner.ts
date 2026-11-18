import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { withCancellation } from '../common/cancellation.js';
import { withProgress, type StepId } from '../common/progress.js';
import { AppPaths } from '../config/app-paths.js';
import {
  batchRequestSchema,
  jobRequestSchema,
  type JobRequest,
  type PercentRect,
} from '../contracts/job.js';
import { JobRepository, type BatchRow, type JobRow } from '../database/job.repository.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Workspace } from '../workspace/workspace.js';
import { CutPipeline } from './cut-pipeline.js';
import { JobEvents } from './job-events.js';
import { clipView, jobView } from './job-views.js';
import { LibraryService } from './library.service.js';
import { LivePipeline } from './live-pipeline.js';
import { CanceledError, type Pipeline, type PipelineContext } from './pipeline-context.js';
import { presetOf } from './presets.js';
import { StepTracker, type JobStepId, type StepState } from './step-tracker.js';

const IDLE_MS = 1500;
const MAX_LIVES = 3;
const MAX_TOGETHER = 8;
const QUEUE_PEEK = 200;
const FINISHED = ['done', 'failed', 'canceled', 'interrupted'];
const PERSIST_MS = 1000;

const STEP_ALIASES: Partial<Record<StepId, JobStepId>> = {
  download: 'download',
  bottom: 'bottom',
  captions: 'transcribe',
  transcribe: 'transcribe',
  refine: 'transcribe',
  plan: 'select',
  select: 'select',
  render: 'render',
  organize: 'organize',
  live: 'live',
  camera: 'camera',
};

interface Active {
  id: string;
  lane: 'cut' | 'live' | 'together';
  controller: AbortController;
  camera: ((rect: PercentRect) => void) | null;
  holding: boolean;
}

interface SlotWaiter {
  id: string;
  grant: () => void;
}

@Injectable()
export class JobRunner implements OnModuleDestroy {
  private readonly active = new Map<string, Active>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly slotWaiters: SlotWaiter[] = [];
  private slot: string | null = null;
  private running = false;
  private wake: (() => void) | null = null;
  private loopDone: Promise<void> | null = null;

  constructor(
    private readonly jobs: JobRepository,
    private readonly events: JobEvents,
    private readonly library: LibraryService,
    private readonly cut: CutPipeline,
    private readonly live: LivePipeline,
    private readonly paths: AppPaths,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const interrupted = await this.jobs.interruptRunning();
    if (interrupted > 0)
      process.stderr.write(`> ${String(interrupted)} tarefa(s) interrompida(s)\n`);
    this.loopDone = this.loop();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    for (const item of this.active.values()) item.controller.abort();
    this.wake?.();
    await this.loopDone;
    await Promise.allSettled([...this.tasks]);
  }

  async submit(input: unknown): Promise<JobRow> {
    const request = validRequest(input);
    const job = await this.create(request);
    this.wake?.();
    return job;
  }

  async submitBatch(input: unknown): Promise<{ batch: BatchRow; jobs: JobRow[] }> {
    const parsed = batchRequestSchema.safeParse(input);
    if (!parsed.success) throw new AppError('INVALID_INPUT', firstIssue(parsed.error.issues));
    const batch = parsed.data;
    const preset = presetOf(batch.preset);
    const longest = Math.max(...batch.items.map((item) => item.videos.length));
    const requests: JobRequest[] = [];
    for (let round = 0; round < longest; round += 1) {
      for (const item of batch.items) {
        const video = item.videos[round];
        if (video === undefined) continue;
        const source = video.source;
        requests.push(
          validRequest({
            preset: batch.preset,
            source,
            targets: batch.targets,
            selector: video.selector ?? batch.selector,
            accounts: item.account === null ? [] : [item.account],
            ...(batch.bottom === undefined ? {} : { bottom: batch.bottom }),
            ...(batch.mode === 'together' && source.type !== 'live' ? { together: true } : {}),
            title: `${item.account ?? 'sem conta'} · ${sourceName(source)} ${String(round + 1)}`,
          }),
        );
      }
    }
    const row = await this.jobs.createBatch({
      title: batch.title ?? defaultBatchTitle(preset.label),
      preset: batch.preset,
    });
    const jobs: JobRow[] = [];
    for (const request of requests) jobs.push(await this.create(request, row.id));
    this.wake?.();
    return { batch: row, jobs };
  }

  async cancelBatch(id: string): Promise<number> {
    const jobs = await this.jobs.jobsOfBatch(id);
    let count = 0;
    for (const job of jobs) {
      if (['queued', 'running', 'waiting'].includes(job.status)) {
        await this.cancel(job.id).catch(() => undefined);
        count += 1;
      }
    }
    return count;
  }

  async forgetBatch(id: string): Promise<void> {
    const jobs = await this.jobs.jobsOfBatch(id);
    if (jobs.some((job) => !FINISHED.includes(job.status))) {
      throw new AppError('INVALID_INPUT', 'pare a fila antes de apagar');
    }
    for (const job of jobs) await this.forget(job.id);
    await this.jobs.removeBatch(id);
  }

  private async create(request: JobRequest, batchId?: string): Promise<JobRow> {
    const preset = presetOf(request.preset);
    const id = randomUUID();
    const job = await this.jobs.create({
      id,
      kind: request.source.type === 'live' ? 'live' : 'cut',
      title: request.title ?? defaultTitle(request, preset.label),
      preset: request.preset,
      request: request,
      workDir: path.join(this.paths.jobsDir, id),
      ...(batchId === undefined ? {} : { batchId }),
    });
    this.events.publish({ type: 'job', jobId: job.id, job: jobView(job) });
    return job;
  }

  async cancel(id: string): Promise<JobRow> {
    const job = await this.jobs.get(id);
    const running = this.active.get(id);
    if (running !== undefined) {
      running.controller.abort();
      return this.setStatus(id, { status: 'canceled', finishedAt: new Date(), waiting: null });
    }
    if (job.status !== 'queued')
      throw new AppError('INVALID_INPUT', 'essa tarefa não pode ser cancelada');
    return this.setStatus(id, { status: 'canceled', finishedAt: new Date() });
  }

  provideCamera(id: string, rect: PercentRect): void {
    const running = this.active.get(id);
    if (running?.camera === undefined || running.camera === null) {
      throw new AppError('INVALID_INPUT', 'essa tarefa não está esperando o enquadramento');
    }
    running.camera(rect);
  }

  async cameraFrame(id: string, at: number): Promise<{ frame: string; at: number }> {
    const running = this.active.get(id);
    if (running?.camera === undefined || running.camera === null || running.lane === 'live') {
      throw new AppError('INVALID_INPUT', 'essa tarefa não está esperando o enquadramento');
    }
    const job = await this.jobs.get(id);
    return this.cut.frameAt(new Workspace(path.join(job.workDir, 'work')), at);
  }

  async forget(id: string): Promise<void> {
    const job = await this.jobs.get(id);
    if (!FINISHED.includes(job.status) || this.active.has(id)) {
      throw new AppError('INVALID_INPUT', 'pare a tarefa antes de apagar do histórico');
    }
    await this.jobs.remove(id);
    await this.dropWorkDir(job.workDir);
    this.events.publish({ type: 'removed', jobId: id });
  }

  async forgetFinished(): Promise<number> {
    const removed = await this.jobs.removeFinished(FINISHED);
    for (const job of removed) {
      await this.dropWorkDir(job.workDir);
      this.events.publish({ type: 'removed', jobId: job.id });
    }
    return removed.length;
  }

  private async dropWorkDir(workDir: string): Promise<void> {
    const folder = path.resolve(workDir);
    const root = path.resolve(this.paths.jobsDir);
    if (path.dirname(folder) !== root) return;
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }

  async retry(id: string): Promise<JobRow> {
    const job = await this.jobs.get(id);
    if (!['failed', 'canceled', 'interrupted'].includes(job.status)) {
      throw new AppError('INVALID_INPUT', 'só dá para repetir uma tarefa que parou');
    }
    const request = jobRequestSchema.parse(job.request);
    return this.submit({ ...request, resume: job.id });
  }

  activeId(): string | null {
    return this.slot ?? this.active.keys().next().value ?? null;
  }

  activeIds(): string[] {
    return [...this.active.keys()];
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const started =
        (await this.startCut()) || (await this.startTogether()) || (await this.startLive());
      if (started) continue;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        setTimeout(resolve, IDLE_MS).unref();
      });
      this.wake = null;
    }
  }

  private async startCut(): Promise<boolean> {
    if (!this.slotFree()) return false;
    const next = await this.nextCut(false);
    if (next === null || !this.running || !this.slotFree()) return false;
    this.slot = next.id;
    this.launch(next, 'cut');
    return true;
  }

  private async startTogether(): Promise<boolean> {
    const together = [...this.active.values()].filter((item) => item.lane === 'together').length;
    if (together >= MAX_TOGETHER) return false;
    const next = await this.nextCut(true);
    if (next === null || !this.running) return false;
    this.launch(next, 'together');
    return true;
  }

  private async nextCut(together: boolean): Promise<JobRow | null> {
    const queued = await this.jobs
      .queued('cut', [...this.active.keys()], QUEUE_PEEK)
      .catch(() => [] as JobRow[]);
    return queued.find((job) => isTogether(job) === together) ?? null;
  }

  private async startLive(): Promise<boolean> {
    const lives = [...this.active.values()].filter((item) => item.lane === 'live').length;
    if (lives >= MAX_LIVES) return false;
    const next = await this.jobs.nextQueued('live', [...this.active.keys()]).catch(() => null);
    if (next === null || !this.running) return false;
    this.launch(next, 'live');
    return true;
  }

  private launch(job: JobRow, lane: Active['lane']): void {
    const active: Active = {
      id: job.id,
      lane,
      controller: new AbortController(),
      camera: null,
      holding: lane === 'cut',
    };
    this.active.set(job.id, active);
    const task = this.execute(job, active).finally(() => {
      this.tasks.delete(task);
      this.active.delete(job.id);
      this.releaseSlot(active);
      this.wake?.();
    });
    this.tasks.add(task);
  }

  private slotFree(): boolean {
    return this.slot === null && this.slotWaiters.length === 0;
  }

  private releaseSlot(active: Active): void {
    if (!active.holding) return;
    active.holding = false;
    if (this.slot !== active.id) return;
    this.slot = null;
    const next = this.slotWaiters.shift();
    if (next !== undefined) {
      this.slot = next.id;
      next.grant();
      return;
    }
    this.wake?.();
  }

  private acquireSlot(active: Active): Promise<void> {
    if (active.lane !== 'cut' || active.holding) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const grant = (): void => {
        active.holding = true;
        active.controller.signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = (): void => {
        const index = this.slotWaiters.findIndex((item) => item.id === active.id);
        if (index >= 0) this.slotWaiters.splice(index, 1);
        reject(new CanceledError());
      };
      if (this.slot === null) {
        this.slot = active.id;
        grant();
        return;
      }
      this.slotWaiters.push({ id: active.id, grant });
      active.controller.signal.addEventListener('abort', abort, { once: true });
    });
  }

  private async execute(job: JobRow, active: Active): Promise<void> {
    const request = jobRequestSchema.parse(job.request);
    const preset = presetOf(request.preset);
    const pipeline: Pipeline = request.source.type === 'live' ? this.live : this.cut;
    const controller = active.controller;
    const saving: { last: number; pending: StepState[] | null; timer: NodeJS.Timeout | null } = {
      last: 0,
      pending: null,
      timer: null,
    };
    const persist = (steps: StepState[]): void => {
      saving.pending = steps;
      const wait = PERSIST_MS - (Date.now() - saving.last);
      if (saving.timer !== null) return;
      saving.timer = setTimeout(
        () => {
          saving.timer = null;
          saving.last = Date.now();
          const snapshot = saving.pending;
          saving.pending = null;
          if (snapshot !== null) {
            void this.jobs
              .update(job.id, { steps: snapshot as unknown as Prisma.InputJsonValue })
              .catch(() => undefined);
          }
        },
        Math.max(0, wait),
      );
    };
    const tracker: StepTracker = new StepTracker(pipeline.steps(request, preset), (steps) => {
      this.events.publish({
        type: 'steps',
        jobId: job.id,
        steps,
        remainingSeconds: tracker.totalRemaining(),
      });
      persist(steps);
    });
    let lastMessage = '';
    let listener: ((name: string, data: Record<string, unknown>) => void) | null = null;
    const log = (level: 'info' | 'warn' | 'error', message: string): void => {
      this.events.publish({
        type: 'log',
        jobId: job.id,
        level,
        message,
        at: new Date().toISOString(),
      });
      void this.jobs.log(job.id, level, message).catch(() => undefined);
    };
    const context: PipelineContext = {
      job,
      request,
      preset,
      workspace: new Workspace(path.join(job.workDir, 'work')),
      outDir: path.join(job.workDir, 'out'),
      tracker,
      signal: controller.signal,
      log,
      waitForCamera: (frame, suggestion, timeline) =>
        new Promise<PercentRect>((resolve, reject) => {
          active.camera = (rect) => {
            active.camera = null;
            void this.acquireSlot(active)
              .then(() => this.setStatus(job.id, { status: 'running', waiting: null }))
              .then(() => {
                resolve(rect);
              }, reject);
          };
          controller.signal.addEventListener(
            'abort',
            () => {
              reject(new CanceledError());
            },
            { once: true },
          );
          this.releaseSlot(active);
          void this.setStatus(job.id, {
            status: 'waiting',
            waiting: { kind: 'camera', frame, suggestion, ...(timeline ?? {}) },
          });
        }),
      setWaiting: async (data) => {
        if (data === null) await this.acquireSlot(active);
        else if (data.kind === 'agent') this.releaseSlot(active);
        await this.setStatus(job.id, {
          status: data === null ? 'running' : 'waiting',
          waiting: data === null ? null : (data as Prisma.InputJsonValue),
        });
      },
      addClip: async (clip) => {
        try {
          const row = await this.library.add({ ...clip, jobId: job.id, jobTitle: job.title });
          this.events.publish({ type: 'clip', jobId: job.id, clip: clipView(row) });
        } catch (error) {
          log('error', `não consegui guardar ${clip.clipId}: ${describe(error)}`);
        }
      },
      listen: (handler) => {
        listener = handler;
      },
    };
    await this.setStatus(job.id, { status: 'running', startedAt: new Date(), error: null });
    try {
      const summary = await withProgress(
        {
          step: (update) => {
            const id = STEP_ALIASES[update.step];
            if (id === undefined || !tracker.has(id)) return;
            tracker.update(id, update.fraction, update.message);
            if (update.message !== lastMessage && update.fraction === null) {
              lastMessage = update.message;
              log('info', update.message);
            }
          },
          event: (name, data) => {
            listener?.(name, data);
          },
        },
        () => withCancellation(controller.signal, () => pipeline.run(context)),
      );
      if (saving.timer !== null) clearTimeout(saving.timer);
      await this.jobs.update(job.id, {
        steps: tracker.snapshot() as unknown as Prisma.InputJsonValue,
      });
      await this.setStatus(job.id, {
        status: controller.signal.aborted ? 'canceled' : 'done',
        finishedAt: new Date(),
        summary: summary as Prisma.InputJsonValue,
        waiting: null,
      });
    } catch (error) {
      if (saving.timer !== null) clearTimeout(saving.timer);
      const canceled = controller.signal.aborted || error instanceof CanceledError;
      const message = canceled ? 'tarefa cancelada' : describe(error);
      tracker.fail(message);
      await this.jobs
        .update(job.id, { steps: tracker.snapshot() as unknown as Prisma.InputJsonValue })
        .catch(() => undefined);
      if (!canceled) log('error', message);
      await this.setStatus(job.id, {
        status: canceled ? 'canceled' : 'failed',
        error: canceled ? null : message.slice(0, 1000),
        finishedAt: new Date(),
        waiting: null,
      }).catch(() => undefined);
    } finally {
      await fs
        .rm(path.join(job.workDir, 'out'), { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  private async setStatus(
    id: string,
    patch: Parameters<JobRepository['update']>[1],
  ): Promise<JobRow> {
    const row = await this.jobs.update(id, patch);
    this.events.publish({ type: 'job', jobId: id, job: jobView(row) });
    return row;
  }
}

function isTogether(job: JobRow): boolean {
  const request = job.request as { together?: unknown } | null;
  return request?.together === true;
}

function defaultTitle(request: JobRequest, label: string): string {
  return `${label} · ${sourceName(request.source)} · ${stamp()}`;
}

function validRequest(input: unknown): JobRequest {
  const parsed = jobRequestSchema.safeParse(input);
  if (!parsed.success) throw new AppError('INVALID_INPUT', firstIssue(parsed.error.issues));
  const request = parsed.data;
  const preset = presetOf(request.preset);
  if (!preset.sources.includes(request.source.type)) {
    throw new AppError('INVALID_INPUT', `${preset.label} não aceita essa origem de vídeo`);
  }
  return request;
}

function firstIssue(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const issue = issues[0];
  if (issue === undefined) return 'pedido inválido';
  return `${issue.path.map(String).join('.')}: ${issue.message}`;
}

function sourceName(source: JobRequest['source']): string {
  if (source.type === 'file') return 'arquivo';
  if (source.type === 'youtube') return 'YouTube';
  if (source.type === 'vod') return `VOD ${source.platform}`;
  return `live ${source.platform}`;
}

function defaultBatchTitle(label: string): string {
  return `Fila · ${label} · ${stamp()}`;
}

function stamp(): string {
  return new Date().toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? 'erro') : 'erro inesperado';
}
