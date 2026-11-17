import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { withCancellation } from '../common/cancellation.js';
import { withProgress, type StepId } from '../common/progress.js';
import { AppPaths } from '../config/app-paths.js';
import { jobRequestSchema, type JobRequest, type PercentRect } from '../contracts/job.js';
import { JobRepository, type JobRow } from '../database/job.repository.js';
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
  controller: AbortController;
  camera: ((rect: PercentRect) => void) | null;
}

@Injectable()
export class JobRunner implements OnModuleDestroy {
  private active: Active | null = null;
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
    this.active?.controller.abort();
    this.wake?.();
    await this.loopDone;
  }

  async submit(input: unknown): Promise<JobRow> {
    const parsed = jobRequestSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(
        'INVALID_INPUT',
        issue === undefined ? 'pedido inválido' : `${issue.path.join('.')}: ${issue.message}`,
      );
    }
    const request = parsed.data;
    const preset = presetOf(request.preset);
    const id = randomUUID();
    const job = await this.jobs.create({
      id,
      kind: request.source.type === 'live' ? 'live' : 'cut',
      title: request.title ?? defaultTitle(request, preset.label),
      preset: request.preset,
      request: request,
      workDir: path.join(this.paths.jobsDir, id),
    });
    this.events.publish({ type: 'job', jobId: job.id, job: jobView(job) });
    this.wake?.();
    return job;
  }

  async cancel(id: string): Promise<JobRow> {
    const job = await this.jobs.get(id);
    if (this.active?.id === id) {
      this.active.controller.abort();
      return this.setStatus(id, { status: 'canceled', finishedAt: new Date(), waiting: null });
    }
    if (job.status !== 'queued')
      throw new AppError('INVALID_INPUT', 'essa tarefa não pode ser cancelada');
    return this.setStatus(id, { status: 'canceled', finishedAt: new Date() });
  }

  provideCamera(id: string, rect: PercentRect): void {
    if (this.active?.id !== id || this.active.camera === null) {
      throw new AppError('INVALID_INPUT', 'essa tarefa não está esperando o enquadramento');
    }
    this.active.camera(rect);
  }

  async forget(id: string): Promise<void> {
    const job = await this.jobs.get(id);
    if (!FINISHED.includes(job.status) || this.active?.id === id) {
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
    return this.active?.id ?? null;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const next = this.active === null ? await this.jobs.nextQueued().catch(() => null) : null;
      if (next === null) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
          setTimeout(resolve, IDLE_MS).unref();
        });
        this.wake = null;
        continue;
      }
      await this.execute(next);
    }
  }

  private async execute(job: JobRow): Promise<void> {
    const request = jobRequestSchema.parse(job.request);
    const preset = presetOf(request.preset);
    const pipeline: Pipeline = request.source.type === 'live' ? this.live : this.cut;
    const controller = new AbortController();
    const active: Active = { id: job.id, controller, camera: null };
    this.active = active;
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
      waitForCamera: (frame, suggestion) =>
        new Promise<PercentRect>((resolve, reject) => {
          active.camera = (rect) => {
            active.camera = null;
            void this.setStatus(job.id, { status: 'running', waiting: null }).then(() => {
              resolve(rect);
            });
          };
          controller.signal.addEventListener(
            'abort',
            () => {
              reject(new CanceledError());
            },
            { once: true },
          );
          void this.setStatus(job.id, {
            status: 'waiting',
            waiting: { kind: 'camera', frame, suggestion },
          });
        }),
      setWaiting: async (data) => {
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
      this.active = null;
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

function defaultTitle(request: JobRequest, label: string): string {
  const source = request.source;
  const origin =
    source.type === 'file'
      ? 'arquivo'
      : source.type === 'youtube'
        ? 'YouTube'
        : source.type === 'vod'
          ? `VOD ${source.platform}`
          : `live ${source.platform}`;
  const stamp = new Date().toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${label} · ${origin} · ${stamp}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? 'erro') : 'erro inesperado';
}
