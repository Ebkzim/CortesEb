import { Injectable } from '@nestjs/common';
import { Output } from '../common/output.js';
import type { Job } from '../contracts/publish.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { CredentialVault } from './credential-vault.js';
import { InstagramPublisher } from './instagram-publisher.js';
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
  ) {}

  publisherFor(platform: Job['platform'], options?: WorkerOptions): Publisher {
    if (options?.mode !== 'live') return this.outbox.for(platform);
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
      const result = await this.publisherFor(job.platform, options).publish(job);
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
