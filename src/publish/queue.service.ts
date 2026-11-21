import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { AccountService } from '../accounts/account.service.js';
import { AppError } from '../common/app-error.js';
import { PLATFORMS, type Job, type JobStatus, type Platform } from '../contracts/publish.js';
import { LibraryPostText, type PostTextLookup } from './post-text.js';
import { QueueStore } from './queue-store.js';

export interface EnqueueRequest {
  files: string[];
  accounts: string[] | undefined;
  platforms: Platform[] | undefined;
  title: string | undefined;
  description: string | undefined;
  tags: string[];
  scheduledAt: string | undefined;
}

export interface QueueSummary {
  total: number;
  byStatus: Record<JobStatus, number>;
}

@Injectable()
export class QueueService {
  constructor(
    private readonly store: QueueStore,
    private readonly accounts: AccountService,
    @Inject(LibraryPostText) private readonly postText: PostTextLookup,
  ) {}

  async enqueue(request: EnqueueRequest): Promise<Job[]> {
    const accounts = await this.accounts.resolve(request.accounts);
    if (accounts.length === 0) {
      throw new AppError(
        'INVALID_INPUT',
        'cadastre uma conta antes de enfileirar (cortes-eb account add)',
      );
    }
    const platforms = request.platforms ?? [...PLATFORMS];
    const jobs: Job[] = [];
    for (const file of request.files) {
      const text = await this.postText.find(file);
      const description = request.description ?? text?.description ?? undefined;
      const tags = request.tags.length > 0 ? request.tags : (text?.hashtags ?? []);
      for (const account of accounts) {
        for (const platform of platforms) {
          jobs.push(
            await this.store.add({
              file,
              account: account.id,
              platform,
              title: (request.title ?? text?.title ?? titleFrom(file)).slice(0, 100),
              ...(description === undefined ? {} : { description }),
              tags,
              ...(request.scheduledAt === undefined ? {} : { scheduledAt: request.scheduledAt }),
            }),
          );
        }
      }
    }
    return jobs;
  }

  async approve(ids: readonly string[]): Promise<Job[]> {
    return this.move(await this.select(ids, 'pending'), 'approved');
  }

  async reject(ids: readonly string[]): Promise<Job[]> {
    const open = (await this.store.list()).filter(
      (job) => job.status === 'pending' || job.status === 'approved' || job.status === 'failed',
    );
    return this.move(this.pick(open, ids), 'rejected');
  }

  async retry(ids: readonly string[]): Promise<Job[]> {
    return this.move(await this.select(ids, 'failed'), 'approved');
  }

  async summary(): Promise<QueueSummary> {
    const jobs = await this.store.list();
    const byStatus: Record<JobStatus, number> = {
      pending: 0,
      approved: 0,
      publishing: 0,
      published: 0,
      failed: 0,
      rejected: 0,
    };
    for (const job of jobs) byStatus[job.status] += 1;
    return { total: jobs.length, byStatus };
  }

  list(status?: JobStatus): Promise<Job[]> {
    return this.store.list(status);
  }

  private async select(ids: readonly string[], status: JobStatus): Promise<Job[]> {
    return this.pick(await this.store.list(status), ids);
  }

  private pick(pool: readonly Job[], ids: readonly string[]): Job[] {
    if (ids.length === 1 && ids[0] === 'all') return [...pool];
    return ids.map((id) => {
      const job = pool.find((item) => item.id === id);
      if (job === undefined)
        throw new AppError('INVALID_INPUT', `o item ${id} não está nesse estado`);
      return job;
    });
  }

  private async move(jobs: readonly Job[], to: JobStatus): Promise<Job[]> {
    const done: Job[] = [];
    for (const job of jobs) done.push(await this.store.transition(job.id, to));
    return done;
  }
}

function titleFrom(file: string): string {
  const stem = path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').trim();
  return (stem === '' ? 'Corte' : stem).slice(0, 100);
}
