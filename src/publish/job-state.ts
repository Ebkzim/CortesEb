import { AppError } from '../common/app-error.js';
import type { Job, JobStatus } from '../contracts/publish.js';

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ['approved', 'rejected'],
  approved: ['publishing', 'rejected', 'pending'],
  publishing: ['published', 'failed', 'approved'],
  failed: ['approved', 'rejected'],
  published: [],
  rejected: [],
};

export type JobPatch = Partial<Pick<Job, 'error' | 'publishedUrl' | 'scheduledAt' | 'attempts'>>;

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isFinal(status: JobStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function advance(job: Job, to: JobStatus, now: Date, patch: JobPatch = {}): Job {
  if (!canTransition(job.status, to)) {
    throw new AppError('INVALID_INPUT', `o item ${job.id} não pode ir de ${job.status} para ${to}`);
  }
  const next: Job = { ...job, ...patch, status: to, updatedAt: now.toISOString() };
  if ((to === 'approved' || to === 'published') && patch.error === undefined) delete next.error;
  return next;
}
