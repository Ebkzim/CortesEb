import type { JobRequest, PercentRect } from '../contracts/job.js';
import type { JobRow } from '../database/job.repository.js';
import type { Workspace } from '../workspace/workspace.js';
import type { Preset } from './presets.js';
import type { JobStepId, StepTracker } from './step-tracker.js';

export interface FinishedClip {
  file: string;
  clipId: string;
  title: string;
  hook: string | null;
  score: number | null;
  account: string | null;
}

export interface CameraTimeline {
  duration: number;
  at: number;
  strip: { name: string; at: number }[];
}

export interface PipelineContext {
  job: JobRow;
  request: JobRequest;
  preset: Preset;
  workspace: Workspace;
  outDir: string;
  tracker: StepTracker;
  signal: AbortSignal;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  waitForCamera(
    frame: string,
    suggestion: PercentRect,
    timeline?: CameraTimeline,
  ): Promise<PercentRect>;
  setWaiting(data: Record<string, unknown> | null): Promise<void>;
  addClip(clip: FinishedClip): Promise<void>;
  listen(handler: (name: string, data: Record<string, unknown>) => void): void;
}

export interface Pipeline {
  steps(request: JobRequest, preset: Preset): JobStepId[];
  run(context: PipelineContext): Promise<Record<string, unknown>>;
}

export class CanceledError extends Error {
  constructor() {
    super('tarefa cancelada');
    this.name = 'CanceledError';
  }
}

export function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw new CanceledError();
}

export function pause(ms: number, signal: AbortSignal): Promise<void> {
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
