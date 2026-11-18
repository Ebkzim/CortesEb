import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../common/app-error.js';
import { exists } from '../common/json-file.js';
import type { Progress } from '../common/progress.js';
import { resolveInside } from '../common/safe-path.js';
import type { Platform } from '../contracts/publish.js';
import type { CameraSpec } from '../layout/camera.js';
import type { ClipFactory, FactoryOptions, PreparedClip } from './clip-factory.js';
import { AdWatcher } from './ad-watcher.js';
import type { LlmClient } from '../llm/llm-client.js';
import type { ClipJudge } from './clip-judge.js';
import { ChatCounter } from './chat-counter.js';
import type { ChatSource } from './twitch-chat.js';
import { LiveDetector, type LiveOptions, type LiveWindow } from './live-detector.js';
import type { LiveRecorder, Recording, ResolvedStream } from './live-recorder.js';
import type { RmsSample } from './rms-stream.js';
import { coveredUntil, parseSegmentList, type Segment } from './segment-log.js';

export interface LiveRequest {
  link: string;
  outDir: string;
  accounts: string[] | undefined;
  bottom: string | null;
  language: string | undefined;
  model: FactoryOptions['model'];
  detector: Partial<LiveOptions>;
  maxHeight: number;
  maxPerHour: number;
  maxClips: number;
  offlineWait: number;
  keepSeconds: number;
  minWords: number;
  maxQueue: number;
  keepWork: boolean;
  chat: boolean;
  judge: { minScore: number; niche: string; client?: LlmClient } | null;
  enqueue: Platform[] | null;
  camera: CameraSpec | null;
  credit: string | null;
  protocols?: string;
}

export interface LiveSummary {
  accepted: number;
  produced: number;
  skipped: number;
  failed: number;
  outDir: string;
}

export interface ProducedClip {
  id: string;
  hook: string | null;
  files: { account: string | null; file: string }[];
}

export interface SessionDeps {
  recorder: LiveRecorder;
  factory: ClipFactory;
  progress: Progress;
  chat: ChatSource | null;
  judge: ClipJudge | null;
  enqueue: (clip: ProducedClip) => Promise<number>;
  watchAds: boolean;
  fetchBottom: (source: string, workRoot: string) => Promise<string>;
}

const HOUR_SECONDS = 3600;
const STALL_MS = 60_000;
const RETRY_MS = 10_000;
const COVER_WAIT_MS = 12_000;
const HOUSEKEEPING_MS = 15_000;
const RESTART_PAUSE_MS = 4_000;

interface Epoch {
  epoch: number;
  base: number;
  list: string;
}

export class LiveSession {
  private readonly detector: LiveDetector;
  private readonly chat = new ChatCounter();
  private readonly recordingDir: string;
  private readonly workRoot: string;
  private readonly epochs: Epoch[] = [];
  private readonly removed = new Set<string>();
  private readonly queue: PreparedClip[] = [];
  private readonly producedAt: number[] = [];
  private chain: Promise<void> = Promise.resolve();
  private worker: Promise<void> | null = null;
  private recording: Recording | null = null;
  private bottomFile: string | null = null;
  private base = 0;
  private latest = 0;
  private lastSample = Date.now();
  private sequence = 0;
  private stopping = false;
  private adActive = false;
  private readonly summary: LiveSummary;

  constructor(
    private readonly request: LiveRequest,
    private readonly deps: SessionDeps,
    private readonly signal: AbortSignal,
  ) {
    this.detector = new LiveDetector(request.detector);
    this.workRoot = path.join(path.resolve(request.outDir), '.live');
    this.recordingDir = path.join(this.workRoot, 'rec');
    this.summary = {
      accepted: 0,
      produced: 0,
      skipped: 0,
      failed: 0,
      outDir: path.resolve(request.outDir),
    };
  }

  async run(): Promise<LiveSummary> {
    await fs.rm(this.recordingDir, { recursive: true, force: true });
    await fs.mkdir(this.recordingDir, { recursive: true });
    this.bottomFile =
      this.request.bottom === null
        ? null
        : await this.deps.fetchBottom(this.request.bottom, this.workRoot);
    this.signal.addEventListener('abort', () => this.recording?.stop(), { once: true });
    this.deps.chat?.start(
      () => {
        this.chat.add(this.latest);
      },
      (message) => {
        this.deps.progress.step('live', null, `chat da Twitch: ${message}`);
      },
    );
    this.emit({
      event: 'start',
      link: this.request.link,
      out: this.summary.outDir,
      chat: this.deps.chat !== null,
    });
    const timer = setInterval(() => {
      this.trim().catch(() => undefined);
    }, HOUSEKEEPING_MS);
    try {
      await this.recordLoop();
    } finally {
      clearInterval(timer);
      this.deps.chat?.stop();
    }
    if (this.signal.aborted) this.queue.length = 0;
    else for (const window of this.detector.flush()) this.schedule(window);
    await this.chain;
    await this.worker;
    this.emit({ event: 'end', ...this.summary });
    await fs.rm(this.recordingDir, { recursive: true, force: true });
    return this.summary;
  }

  private async recordLoop(): Promise<void> {
    let offlineSince: number | null = null;
    let epoch = 0;
    while (!this.halted()) {
      let input: ResolvedStream;
      try {
        const resolved = await this.deps.recorder.resolve(
          this.request.link,
          this.request.maxHeight,
        );
        if (!resolved.live) {
          if (epoch === 0) throw new AppError('INVALID_INPUT', 'esse link não está ao vivo agora');
          this.deps.progress.step('live', null, 'a live terminou');
          return;
        }
        input = resolved;
        offlineSince = null;
      } catch (error) {
        if (error instanceof AppError && error.code === 'INVALID_INPUT') throw error;
        offlineSince ??= Date.now();
        if ((Date.now() - offlineSince) / 1000 > this.request.offlineWait) {
          this.deps.progress.step('live', null, 'a live não voltou, encerrando');
          return;
        }
        this.deps.progress.step('live', null, 'live indisponível, tentando de novo em instantes');
        await sleep(RETRY_MS, this.signal);
        continue;
      }
      await this.recordOnce(input, epoch);
      epoch += 1;
      if (this.halted()) return;
      this.deps.progress.step('live', null, 'gravação interrompida, reconectando');
      await sleep(RESTART_PAUSE_MS, this.signal);
    }
  }

  private async recordOnce(input: ResolvedStream, epoch: number): Promise<void> {
    const recording = this.deps.recorder.start(
      {
        input: input.url,
        ...(input.audioUrl === undefined ? {} : { audioInput: input.audioUrl }),
        dir: this.recordingDir,
        epoch,
        ...(this.request.protocols === undefined ? {} : { protocols: this.request.protocols }),
      },
      (sample) => {
        this.onSample(sample);
      },
    );
    this.recording = recording;
    this.lastSample = Date.now();
    const ads = this.deps.watchAds
      ? new AdWatcher(input.url, (active) => {
          this.adActive = active;
          this.emit({ event: 'ad', active });
        })
      : null;
    ads?.start();
    this.epochs.push({ epoch, base: this.base, list: recording.list });
    const watchdog = setInterval(() => {
      if (Date.now() - this.lastSample > STALL_MS) recording.stop();
    }, STALL_MS / 4);
    await recording.exited;
    clearInterval(watchdog);
    ads?.stop();
    this.recording = null;
    this.base = Math.max(this.base, coveredUntil(await this.readList(recording.list)));
  }

  private halted(): boolean {
    return this.signal.aborted || this.stopping;
  }

  private onSample(sample: RmsSample): void {
    this.lastSample = Date.now();
    const time = this.base + sample.time;
    this.latest = time;
    if (this.adActive) return;
    for (const window of this.detector.push(time, sample.level, this.chat.boost(time)))
      this.schedule(window);
  }

  private schedule(window: LiveWindow): void {
    const stamp = { emittedAt: Date.now(), emittedStream: this.latest };
    this.chain = this.chain
      .then(() => this.accept(window, stamp))
      .catch((error: unknown) => {
        this.summary.failed += 1;
        this.emit({ event: 'error', where: 'prepare', message: messageOf(error) });
      });
  }

  private async accept(
    window: LiveWindow,
    stamp: { emittedAt: number; emittedStream: number },
  ): Promise<void> {
    const at = clock(window.peakAt);
    if (this.request.maxClips > 0 && this.summary.produced >= this.request.maxClips) return;
    const cutoff = Date.now() - HOUR_SECONDS * 1000;
    while ((this.producedAt[0] ?? Infinity) < cutoff) this.producedAt.shift();
    if (this.producedAt.length >= this.request.maxPerHour) {
      this.skip(at, 'limite de cortes por hora');
      return;
    }
    await this.waitCovered(window.end);
    this.sequence += 1;
    const id = `live-${String(this.sequence).padStart(4, '0')}-${Math.round(window.peakAt)}`;
    const job = await this.deps.factory.prepare(
      id,
      window,
      await this.segments(),
      this.recordingDir,
      this.workRoot,
      this.bottomFile,
      stamp,
    );
    this.summary.accepted += 1;
    this.queue.push(job);
    await this.trimQueue();
    this.kick();
  }

  private async trimQueue(): Promise<void> {
    while (this.queue.length > this.request.maxQueue) {
      let worst = 0;
      this.queue.forEach((job, index) => {
        if (job.window.score < (this.queue[worst]?.window.score ?? Infinity)) worst = index;
      });
      const [dropped] = this.queue.splice(worst, 1);
      if (dropped === undefined) return;
      await fs.rm(dropped.dir, { recursive: true, force: true });
      this.skip(clock(dropped.window.peakAt), 'fila cheia, menor nota descartada');
    }
  }

  private kick(): void {
    if (this.worker !== null) return;
    this.worker = this.drain().finally(() => {
      this.worker = null;
      if (this.queue.length > 0) this.kick();
    });
  }

  private async drain(): Promise<void> {
    for (let job = this.queue.shift(); job !== undefined; job = this.queue.shift()) {
      try {
        this.emit({ event: 'moment', at: clock(job.window.peakAt), queued: this.queue.length });
        const done = await this.deps.factory.produce(job, this.options());
        if (!done.ok) {
          this.skip(clock(job.window.peakAt), done.reason);
          continue;
        }
        const failed = done.results.filter((result) => !result.ok);
        if (failed.length > 0 && failed.length === done.results.length) {
          this.summary.failed += 1;
          this.emit({
            event: 'error',
            id: done.id,
            message: failed[0]?.error ?? 'falha no render',
          });
          continue;
        }
        this.summary.produced += 1;
        this.producedAt.push(Date.now());
        if (this.request.maxClips > 0 && this.summary.produced >= this.request.maxClips) {
          this.stopping = true;
          this.queue.length = 0;
          this.recording?.stop();
        }
        const queued = await this.enqueue(done);
        this.emit({
          event: 'clip',
          id: done.id,
          at: clock(job.window.peakAt),
          hook: done.hook,
          afterPeakSeconds: done.afterPeakSeconds,
          judgeScore: done.judgeScore,
          files: done.results.filter((result) => result.ok).map((result) => result.file),
          queued,
        });
      } catch (error) {
        this.summary.failed += 1;
        this.emit({ event: 'error', id: job.id, message: messageOf(error) });
      }
    }
  }

  private async enqueue(done: {
    id: string;
    hook: string | null;
    results: { ok: boolean; account: string | null; file: string }[];
  }): Promise<number> {
    if (this.request.enqueue === null) return 0;
    const files = done.results
      .filter((result) => result.ok)
      .map((result) => ({ account: result.account, file: result.file }));
    try {
      return await this.deps.enqueue({ id: done.id, hook: done.hook, files });
    } catch (error) {
      this.emit({ event: 'error', id: done.id, message: messageOf(error) });
      return 0;
    }
  }

  private options(): FactoryOptions {
    return {
      outDir: this.request.outDir,
      accounts: this.request.accounts,
      language: this.request.language,
      model: this.request.model,
      hasBottom: this.bottomFile !== null,
      minWords: this.request.minWords,
      keepWork: this.request.keepWork,
      camera: this.request.camera,
      credit: this.request.credit,
      judge: this.deps.judge,
    };
  }

  private skip(at: string, reason: string): void {
    this.summary.skipped += 1;
    this.emit({ event: 'skip', at, reason });
  }

  private emit(event: Record<string, unknown> & { event: string }): void {
    const { event: name, ...data } = event;
    this.deps.progress.event(name, data, true);
  }

  private async waitCovered(until: number): Promise<void> {
    const deadline = Date.now() + COVER_WAIT_MS;
    while (Date.now() < deadline) {
      if (coveredUntil(await this.segments()) >= until) return;
      if (this.halted()) return;
      await sleep(1000, this.signal);
    }
  }

  private async segments(): Promise<Segment[]> {
    const all: Segment[] = [];
    for (const epoch of this.epochs) all.push(...(await this.readList(epoch.list)));
    return all.filter((segment) => !this.removed.has(segment.file));
  }

  private async readList(list: string): Promise<Segment[]> {
    if (!(await exists(list))) return [];
    const epoch = this.epochs.find((item) => item.list === list);
    return parseSegmentList(await fs.readFile(list, 'utf8'), epoch?.base ?? 0);
  }

  private async trim(): Promise<void> {
    const limit = this.latest - this.request.keepSeconds;
    for (const segment of await this.segments()) {
      if (segment.end >= limit) continue;
      await fs.rm(resolveInside(this.recordingDir, segment.file), { force: true });
      this.removed.add(segment.file);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

function clock(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${secs}` : `${minutes}:${secs}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? 'erro') : 'erro';
}
