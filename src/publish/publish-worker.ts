import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { Output } from '../common/output.js';
import { PUBLISHING_DEFAULTS, UserConfigStore, type Publishing } from '../config/user-config.js';
import type { Job } from '../contracts/publish.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { CredentialVault } from './credential-vault.js';
import { BrowserTools } from './browser-tools.js';
import { InstagramPublisher } from './instagram-publisher.js';
import { TikTokPublisher } from './tiktok-publisher.js';
import { InstagramWebPublisher } from './instagram-web-publisher.js';
import { YoutubeWebPublisher } from './youtube-web-publisher.js';
import { methodOf } from './publish-method.js';
import { evaluatePolicy, POLICY_DEFAULTS, type PolicyLimits } from './publish-policy.js';
import { PublishError, type Publisher } from './publisher.js';
import { QueueStore } from './queue-store.js';
import { YoutubePublisher, type Privacy } from './youtube-publisher.js';

export interface WorkerOptions {
  once: boolean;
  intervalMs: number;
  maxAttempts: number;
  baseBackoffMs: number;
  limits?: PolicyLimits;
  mode?: 'outbox' | 'live';
  privacy?: Privacy;
}

export interface WorkerSummary {
  published: number;
  retried: number;
  failed: number;
  delayed: number;
}

export const WORKER_DEFAULTS: WorkerOptions = {
  once: false,
  intervalMs: 30_000,
  maxAttempts: 3,
  baseBackoffMs: 60_000,
};

const ERROR_LIMIT = 480;

@Injectable()
export class PublishWorker {
  constructor(
    private readonly store: QueueStore,
    private readonly outbox: OutboxPublisher,
    private readonly output: Output,
    private readonly vault?: CredentialVault,
    private readonly browser?: BrowserTools,
    private readonly config?: UserConfigStore,
  ) {}

  publisherFor(
    platform: Job['platform'],
    options?: WorkerOptions,
    publishing: Publishing = PUBLISHING_DEFAULTS,
  ): Publisher {
    if (options?.mode !== 'live') return this.outbox.for(platform);
    const browser = this.browser;
    if (methodOf(publishing, platform) === 'browser' && browser !== undefined) {
      const debug = path.join(browser.paths.home, 'browser', 'debug');
      if (platform === 'tiktok') return new TikTokPublisher(browser.sessions, browser.site, debug);
      if (platform === 'instagram') {
        return new InstagramWebPublisher(browser.sessions, browser.site, debug);
      }
      return new YoutubeWebPublisher(
        browser.sessions,
        browser.site,
        debug,
        publishing.youtubeVisibility,
      );
    }
    if (platform === 'youtube' && this.vault !== undefined) {
      return new YoutubePublisher(this.vault, options.privacy ?? 'private');
    }
    if (platform === 'instagram' && this.vault !== undefined) {
      return new InstagramPublisher(this.vault);
    }
    return {
      platform,
      publish: () =>
        Promise.reject(new PublishError(`ainda não há adaptador de ${platform}`, false)),
    };
  }

  async run(options: WorkerOptions, signal: AbortSignal): Promise<WorkerSummary> {
    const lock = await this.store.lockWorker();
    if (lock === null) {
      const pid = await this.store.workerPid();
      throw new AppError(
        'PROCESS_FAILED',
        `já existe um worker de postagem rodando${pid === null ? '' : ` (pid ${String(pid)})`}`,
      );
    }
    const desk = options.mode === 'live' ? this.browser?.server : undefined;
    try {
      await desk?.start();
      return await this.loop(options, signal);
    } finally {
      await desk?.stop().catch(() => undefined);
      await lock.release();
    }
  }

  private async loop(options: WorkerOptions, signal: AbortSignal): Promise<WorkerSummary> {
    const summary: WorkerSummary = { published: 0, retried: 0, failed: 0, delayed: 0 };
    const recovered = await this.store.recoverStale();
    if (recovered > 0) this.event({ event: 'recovered', jobs: recovered });
    while (!signal.aborted) {
      const job = await this.store.claimNext();
      if (job === null) {
        if (options.once) break;
        await sleep(options.intervalMs, signal);
        continue;
      }
      await this.handle(job, options, summary);
    }
    this.event({ event: 'end', ...summary });
    return summary;
  }

  private async handle(job: Job, options: WorkerOptions, summary: WorkerSummary): Promise<void> {
    const decision = evaluatePolicy(
      job,
      await this.store.list('published'),
      new Date(),
      options.limits ?? POLICY_DEFAULTS,
    );
    if (!decision.ok) {
      await this.store.transition(job.id, 'approved', {
        scheduledAt: decision.retryAt.toISOString(),
        attempts: job.attempts - 1,
      });
      summary.delayed += 1;
      this.event({
        event: 'delayed',
        id: job.id,
        until: decision.retryAt.toISOString(),
        reason: decision.reason,
      });
      return;
    }
    try {
      const publishing = (await this.config?.load())?.publishing ?? PUBLISHING_DEFAULTS;
      const result = await this.publisherFor(job.platform, options, publishing).publish(job);
      await this.store.transition(job.id, 'published', { publishedUrl: result.url });
      summary.published += 1;
      this.event({ event: 'published', id: job.id, platform: job.platform, url: result.url });
    } catch (error) {
      const message = describe(error);
      const retryable = error instanceof PublishError ? error.retryable : true;
      if (retryable && job.attempts < options.maxAttempts) {
        const wait = options.baseBackoffMs * 2 ** (job.attempts - 1);
        await this.store.transition(job.id, 'approved', {
          error: message,
          scheduledAt: new Date(Date.now() + wait).toISOString(),
        });
        summary.retried += 1;
        this.event({ event: 'retry', id: job.id, inSeconds: Math.round(wait / 1000), message });
        return;
      }
      await this.store.transition(job.id, 'failed', { error: message });
      summary.failed += 1;
      this.event({ event: 'failed', id: job.id, message });
    }
  }

  private event(data: Record<string, unknown>): void {
    this.output.line(JSON.stringify(data));
  }
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : 'erro inesperado';
  return (text.split(/\r?\n/)[0] ?? 'erro inesperado').slice(0, ERROR_LIMIT);
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
