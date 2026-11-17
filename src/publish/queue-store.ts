import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import {
  jobSchema,
  queueFileSchema,
  type Job,
  type JobStatus,
  type Platform,
  type QueueFile,
} from '../contracts/publish.js';
import { advance, type JobPatch } from './job-state.js';

export interface NewJob {
  file: string;
  account: string;
  platform: Platform;
  title: string;
  description?: string;
  tags?: string[];
  scheduledAt?: string;
}

const QUEUE_MODE = 0o600;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

@Injectable()
export class QueueStore {
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly paths: AppPaths) {}

  add(input: NewJob, now = new Date()): Promise<Job> {
    return this.exclusive(async (queue) => {
      const file = await checkedVideo(input.file);
      const stamp = now.toISOString();
      const job = jobSchema.parse({
        id: `j-${randomBytes(6).toString('hex')}`,
        ...input,
        file,
        status: 'pending',
        attempts: 0,
        createdAt: stamp,
        updatedAt: stamp,
      });
      queue.jobs.push(job);
      return job;
    });
  }

  async list(status?: JobStatus): Promise<Job[]> {
    const queue = await this.load();
    return status === undefined ? queue.jobs : queue.jobs.filter((job) => job.status === status);
  }

  async get(id: string): Promise<Job> {
    const job = (await this.load()).jobs.find((item) => item.id === id);
    if (job === undefined) throw new AppError('INVALID_INPUT', `item ${id} não existe na fila`);
    return job;
  }

  transition(id: string, to: JobStatus, patch: JobPatch = {}, now = new Date()): Promise<Job> {
    return this.exclusive((queue) => {
      const index = queue.jobs.findIndex((item) => item.id === id);
      const current = queue.jobs[index];
      if (current === undefined) {
        throw new AppError('INVALID_INPUT', `item ${id} não existe na fila`);
      }
      const next = advance(current, to, now, patch);
      queue.jobs[index] = next;
      return Promise.resolve(next);
    });
  }

  claimNext(now = new Date()): Promise<Job | null> {
    return this.exclusive((queue) => {
      const due = queue.jobs
        .filter((job) => job.status === 'approved' && isDue(job, now))
        .sort((a, b) => dueAt(a).localeCompare(dueAt(b)))[0];
      if (due === undefined) return Promise.resolve(null);
      const index = queue.jobs.findIndex((job) => job.id === due.id);
      const claimed = advance(due, 'publishing', now, { attempts: due.attempts + 1 });
      queue.jobs[index] = claimed;
      return Promise.resolve(claimed);
    });
  }

  recoverStale(now = new Date()): Promise<number> {
    return this.exclusive((queue) => {
      let recovered = 0;
      queue.jobs = queue.jobs.map((job) => {
        if (job.status !== 'publishing') return job;
        recovered += 1;
        return advance(job, 'approved', now);
      });
      return Promise.resolve(recovered);
    });
  }

  private exclusive<T>(work: (queue: QueueFile) => Promise<T>): Promise<T> {
    const run = this.lock.then(async () => {
      const queue = await this.load();
      const result = await work(queue);
      await writeJson(this.paths.queueFile, queue, QUEUE_MODE);
      return result;
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<QueueFile> {
    if (!(await exists(this.paths.queueFile))) return queueFileSchema.parse({});
    return readJson(this.paths.queueFile, queueFileSchema);
  }
}

function dueAt(job: Job): string {
  return job.scheduledAt ?? job.createdAt;
}

function isDue(job: Job, now: Date): boolean {
  return new Date(dueAt(job)).getTime() <= now.getTime();
}

async function checkedVideo(input: string): Promise<string> {
  const file = path.resolve(input);
  if (path.extname(file).toLowerCase() !== '.mp4') {
    throw new AppError('INVALID_INPUT', 'só aceito vídeos .mp4 na fila');
  }
  const stat = await fs.stat(file).catch(() => null);
  if (stat === null || !stat.isFile()) throw new AppError('MISSING_FILE', `não achei ${file}`);
  if (stat.size > MAX_VIDEO_BYTES) throw new AppError('INVALID_INPUT', 'vídeo maior que 1 GB');
  return file;
}
