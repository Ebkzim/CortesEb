import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';
import type { ClipView, JobView } from './job-views.js';
import type { StepState } from './step-tracker.js';

export type JobEvent =
  | { type: 'job'; jobId: string; job: JobView }
  | { type: 'steps'; jobId: string; steps: StepState[]; remainingSeconds: number | null }
  | { type: 'log'; jobId: string; level: 'info' | 'warn' | 'error'; message: string; at: string }
  | { type: 'clip'; jobId: string; clip: ClipView }
  | { type: 'removed'; jobId: string };

const CHANNEL = 'event';
const MAX_LISTENERS = 200;

@Injectable()
export class JobEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(MAX_LISTENERS);
  }

  publish(event: JobEvent): void {
    this.emitter.emit(CHANNEL, event);
  }

  subscribe(listener: (event: JobEvent) => void): () => void {
    this.emitter.on(CHANNEL, listener);
    return () => {
      this.emitter.off(CHANNEL, listener);
    };
  }
}
