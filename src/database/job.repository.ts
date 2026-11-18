import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import {
  Prisma,
  type Batch,
  type Clip,
  type Job,
  type JobLog,
} from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

export type JobRow = Job;
export type ClipRow = Clip;
export type LogRow = JobLog;
export type BatchRow = Batch;

export interface NewJob {
  id?: string;
  kind: 'cut' | 'live';
  title: string;
  preset: string;
  request: Prisma.InputJsonValue;
  workDir: string;
  batchId?: string;
}

export interface JobPatch {
  status?: string;
  title?: string;
  steps?: Prisma.InputJsonValue;
  waiting?: Prisma.InputJsonValue | null;
  summary?: Prisma.InputJsonValue;
  error?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface NewClip {
  jobId: string;
  day: string;
  title: string;
  hook: string | null;
  score: number | null;
  seconds: number;
  file: string;
  thumb: string | null;
  sizeBytes: number;
  account: string | null;
}

export interface DaySummary {
  day: string;
  clips: number;
  bytes: number;
}

const LOG_LIMIT = 1000;
const PAGE_LIMIT = 100;
const EXAMPLE_SCAN = 300;

@Injectable()
export class JobRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: NewJob): Promise<JobRow> {
    return this.prisma.db.job.create({ data: { ...input, status: 'queued', steps: [] } });
  }

  async get(id: string): Promise<JobRow> {
    const job = await this.prisma.db.job.findUnique({ where: { id } });
    if (job === null) throw new AppError('INVALID_INPUT', 'tarefa não encontrada');
    return job;
  }

  update(id: string, patch: JobPatch): Promise<JobRow> {
    const { waiting, ...rest } = patch;
    return this.prisma.db.job.update({
      where: { id },
      data: {
        ...rest,
        ...(waiting === undefined ? {} : { waiting: waiting === null ? Prisma.DbNull : waiting }),
      },
    });
  }

  list(limit = 30): Promise<JobRow[]> {
    return this.prisma.db.job.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(PAGE_LIMIT, Math.max(1, limit)),
    });
  }

  nextQueued(kind: 'cut' | 'live', skip: readonly string[] = []): Promise<JobRow | null> {
    return this.prisma.db.job.findFirst({
      where: { status: 'queued', kind, ...(skip.length > 0 ? { id: { notIn: [...skip] } } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  queued(kind: 'cut' | 'live', skip: readonly string[], take: number): Promise<JobRow[]> {
    return this.prisma.db.job.findMany({
      where: { status: 'queued', kind, ...(skip.length > 0 ? { id: { notIn: [...skip] } } : {}) },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  async interruptRunning(): Promise<number> {
    const result = await this.prisma.db.job.updateMany({
      where: { status: { in: ['running', 'waiting'] } },
      data: { status: 'interrupted', error: 'o servidor foi reiniciado durante a tarefa' },
    });
    return result.count;
  }

  async log(jobId: string, level: 'info' | 'warn' | 'error', message: string): Promise<void> {
    await this.prisma.db.jobLog.create({
      data: { jobId, level, message: message.slice(0, LOG_LIMIT) },
    });
  }

  logs(jobId: string, limit = 200): Promise<LogRow[]> {
    return this.prisma.db.jobLog.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(LOG_LIMIT, Math.max(1, limit)),
    });
  }

  addClip(input: NewClip): Promise<ClipRow> {
    return this.prisma.db.clip.create({ data: { ...input, sizeBytes: BigInt(input.sizeBytes) } });
  }

  clipsOfJob(jobId: string): Promise<ClipRow[]> {
    return this.prisma.db.clip.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' } });
  }

  clipsOfDay(day: string): Promise<ClipRow[]> {
    return this.prisma.db.clip.findMany({ where: { day }, orderBy: { createdAt: 'desc' } });
  }

  async getClip(id: string): Promise<ClipRow> {
    const clip = await this.prisma.db.clip.findUnique({ where: { id } });
    if (clip === null) throw new AppError('INVALID_INPUT', 'clipe não encontrado');
    return clip;
  }

  async removeClip(id: string): Promise<ClipRow> {
    const clip = await this.getClip(id);
    await this.prisma.db.clip.delete({ where: { id } });
    return clip;
  }

  recentClips(limit = 12): Promise<ClipRow[]> {
    return this.prisma.db.clip.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(PAGE_LIMIT, Math.max(1, limit)),
    });
  }

  async covers(
    jobIds: readonly string[],
  ): Promise<Record<string, { clipId: string; count: number }>> {
    if (jobIds.length === 0) return {};
    const rows = await this.prisma.db.clip.findMany({
      where: { jobId: { in: [...jobIds] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, jobId: true },
    });
    const found: Record<string, { clipId: string; count: number }> = {};
    for (const row of rows) {
      if (row.jobId === null) continue;
      const current = found[row.jobId];
      if (current === undefined) found[row.jobId] = { clipId: row.id, count: 1 };
      else current.count += 1;
    }
    return found;
  }

  async examples(): Promise<Record<string, string>> {
    const rows = await this.prisma.db.clip.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXAMPLE_SCAN,
      select: { id: true, job: { select: { preset: true } } },
    });
    const found: Record<string, string> = {};
    for (const row of rows) {
      if (row.job !== null) found[row.job.preset] ??= row.id;
    }
    return found;
  }

  async remove(id: string): Promise<JobRow> {
    const job = await this.get(id);
    await this.prisma.db.job.delete({ where: { id } });
    return job;
  }

  async removeFinished(statuses: readonly string[]): Promise<JobRow[]> {
    const jobs = await this.prisma.db.job.findMany({ where: { status: { in: [...statuses] } } });
    if (jobs.length > 0) {
      await this.prisma.db.job.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } });
    }
    return jobs;
  }

  createBatch(input: { title: string; preset: string }): Promise<BatchRow> {
    return this.prisma.db.batch.create({ data: input });
  }

  async getBatch(id: string): Promise<BatchRow> {
    const batch = await this.prisma.db.batch.findUnique({ where: { id } });
    if (batch === null) throw new AppError('INVALID_INPUT', 'fila não encontrada');
    return batch;
  }

  listBatches(limit = 20): Promise<(BatchRow & { jobs: { status: string }[] })[]> {
    return this.prisma.db.batch.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(PAGE_LIMIT, Math.max(1, limit)),
      include: { jobs: { select: { status: true } } },
    });
  }

  jobsOfBatch(batchId: string): Promise<JobRow[]> {
    return this.prisma.db.job.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' } });
  }

  clipsOfJobs(jobIds: readonly string[]): Promise<ClipRow[]> {
    if (jobIds.length === 0) return Promise.resolve([]);
    return this.prisma.db.clip.findMany({
      where: { jobId: { in: [...jobIds] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async removeBatch(id: string): Promise<void> {
    await this.prisma.db.batch.delete({ where: { id } });
  }

  async days(): Promise<DaySummary[]> {
    const groups = await this.prisma.db.clip.groupBy({
      by: ['day'],
      _count: { _all: true },
      _sum: { sizeBytes: true },
      orderBy: { day: 'desc' },
    });
    return groups.map((group) => ({
      day: group.day,
      clips: group._count._all,
      bytes: Number(group._sum.sizeBytes ?? 0n),
    }));
  }
}
