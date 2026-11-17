import type { ClipRow, JobRow } from '../database/job.repository.js';
import type { StepState } from './step-tracker.js';

export interface JobView {
  id: string;
  kind: string;
  status: string;
  title: string;
  preset: string;
  request: unknown;
  steps: StepState[];
  waiting: unknown;
  summary: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ClipView {
  id: string;
  jobId: string | null;
  day: string;
  title: string;
  hook: string | null;
  score: number | null;
  seconds: number;
  sizeBytes: number;
  account: string | null;
  hasThumb: boolean;
  createdAt: string;
}

export function jobView(row: JobRow): JobView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    preset: row.preset,
    request: row.request,
    steps: Array.isArray(row.steps) ? (row.steps as unknown as StepState[]) : [],
    waiting: row.waiting,
    summary: row.summary,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function clipView(row: ClipRow): ClipView {
  return {
    id: row.id,
    jobId: row.jobId,
    day: row.day,
    title: row.title,
    hook: row.hook,
    score: row.score,
    seconds: row.seconds,
    sizeBytes: Number(row.sizeBytes),
    account: row.account,
    hasThumb: row.thumb !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
