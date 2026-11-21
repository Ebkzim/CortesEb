import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { ACCOUNT_REF_PATTERN } from '../contracts/cuts.js';
import type { Platform } from '../contracts/publish.js';
import { JobRepository } from '../database/job.repository.js';
import { LibraryService } from '../jobs/library.service.js';
import { CredentialVault } from '../publish/credential-vault.js';
import { PublishService, type ServiceStatus } from '../publish/publish-service.js';
import { QueueService } from '../publish/queue.service.js';
import { QueueStore } from '../publish/queue-store.js';

export const LIVE_PLATFORMS = ['instagram', 'youtube'] as const satisfies readonly Platform[];
export const MAX_SELECTION = 50;

const publishSchema = z.strictObject({
  clipIds: z.array(z.uuid()).min(1).max(MAX_SELECTION),
  account: z.string().regex(ACCOUNT_REF_PATTERN),
  platforms: z.array(z.enum(LIVE_PLATFORMS)).min(1).max(LIVE_PLATFORMS.length),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
});

export interface PublishTarget {
  account: string;
  platforms: Platform[];
}

export interface PublishStatus {
  worker: { running: boolean; pid: number | null };
  service: ServiceStatus;
  targets: PublishTarget[];
}

export interface PublishOutcome {
  queued: { id: string; platform: Platform; scheduledAt: string | null }[];
  workerRunning: boolean;
}

@Controller('api/publish')
export class PublishController {
  constructor(
    private readonly vault: CredentialVault,
    private readonly queue: QueueService,
    private readonly store: QueueStore,
    private readonly service: PublishService,
    private readonly jobs: JobRepository,
    private readonly library: LibraryService,
  ) {}

  @Get('status')
  async status(): Promise<PublishStatus> {
    const pid = await this.store.workerPid();
    return {
      worker: { running: pid !== null, pid },
      service: await this.service.status(),
      targets: await this.targets(),
    };
  }

  @Post()
  async publish(@Body() body: unknown): Promise<PublishOutcome> {
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) throw new AppError('INVALID_INPUT', 'pedido de publicação inválido');
    const request = parsed.data;
    const target = (await this.targets()).find((item) => item.account === request.account);
    const missing = request.platforms.filter((platform) => !target?.platforms.includes(platform));
    if (missing.length > 0) {
      throw new AppError(
        'NOT_CONFIGURED',
        `a conta ${request.account} não tem credenciais de ${missing.join(', ')}`,
      );
    }
    const files: string[] = [];
    for (const id of new Set(request.clipIds)) {
      files.push(this.library.absolute((await this.jobs.getClip(id)).file));
    }
    const future =
      request.scheduledAt !== undefined && new Date(request.scheduledAt).getTime() > Date.now()
        ? new Date(request.scheduledAt).toISOString()
        : undefined;
    const pending = await this.queue.enqueue({
      files,
      accounts: [request.account],
      platforms: [...request.platforms],
      title: undefined,
      description: undefined,
      tags: [],
      scheduledAt: future,
    });
    const approved = await this.queue.approve(pending.map((job) => job.id));
    return {
      queued: approved.map((job) => ({
        id: job.id,
        platform: job.platform,
        scheduledAt: job.scheduledAt ?? null,
      })),
      workerRunning: (await this.store.workerPid()) !== null,
    };
  }

  private async targets(): Promise<PublishTarget[]> {
    const byAccount = new Map<string, Platform[]>();
    for (const entry of await this.vault.list()) {
      if (!(LIVE_PLATFORMS as readonly Platform[]).includes(entry.platform)) continue;
      byAccount.set(entry.account, [...(byAccount.get(entry.account) ?? []), entry.platform]);
    }
    return [...byAccount.entries()]
      .map(([account, platforms]) => ({ account, platforms }))
      .sort((a, b) => a.account.localeCompare(b.account));
  }
}
