import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Output } from './output.js';

export const STEPS = [
  'prepare',
  'download',
  'bottom',
  'captions',
  'transcribe',
  'plan',
  'camera',
  'select',
  'refine',
  'render',
  'organize',
  'live',
] as const;

export type StepId = (typeof STEPS)[number];

export interface StepUpdate {
  step: StepId;
  fraction: number | null;
  message: string;
}

export interface ProgressSink {
  step(update: StepUpdate): void;
  event(name: string, data: Record<string, unknown>): void;
}

const storage = new AsyncLocalStorage<ProgressSink>();

export function withProgress<T>(sink: ProgressSink, work: () => Promise<T>): Promise<T> {
  return storage.run(sink, work);
}

@Injectable()
export class Progress {
  constructor(private readonly output: Output) {}

  step(step: StepId, fraction: number | null, message: string): void {
    const sink = storage.getStore();
    const bounded = fraction === null ? null : Math.max(0, Math.min(1, fraction));
    if (sink !== undefined) {
      sink.step({ step, fraction: bounded, message });
      return;
    }
    this.output.info(`> ${message}`);
  }

  event(name: string, data: Record<string, unknown>, printWhenIdle = false): void {
    const sink = storage.getStore();
    if (sink !== undefined) {
      sink.event(name, data);
      return;
    }
    if (printWhenIdle) this.output.line(JSON.stringify({ event: name, ...data }));
  }

  get active(): boolean {
    return storage.getStore() !== undefined;
  }
}

export function throttled(
  report: (fraction: number) => void,
  step = 0.02,
): (fraction: number) => void {
  let last = -1;
  return (fraction) => {
    if (fraction < 1 && fraction - last < step) return;
    last = fraction;
    report(fraction);
  };
}
