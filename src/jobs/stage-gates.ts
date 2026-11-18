import { Injectable } from '@nestjs/common';
import { CanceledError } from './pipeline-context.js';

export type Stage = 'download' | 'whisper' | 'select-local' | 'select-remote' | 'render';

export const STAGE_LIMITS: Record<Stage, number> = {
  download: 3,
  whisper: 1,
  'select-local': 1,
  'select-remote': 3,
  render: 1,
};

interface Waiter {
  grant: () => void;
}

@Injectable()
export class StageGates {
  private readonly busy = new Map<Stage, number>();
  private readonly queues = new Map<Stage, Waiter[]>();
  private readonly limits: Record<Stage, number> = STAGE_LIMITS;

  async run<T>(
    stage: Stage,
    signal: AbortSignal,
    onWait: () => void,
    task: () => Promise<T>,
  ): Promise<T> {
    await this.acquire(stage, signal, onWait);
    try {
      return await task();
    } finally {
      this.release(stage);
    }
  }

  private acquire(stage: Stage, signal: AbortSignal, onWait: () => void): Promise<void> {
    if (signal.aborted) return Promise.reject(new CanceledError());
    const used = this.busy.get(stage) ?? 0;
    if (used < this.limits[stage]) {
      this.busy.set(stage, used + 1);
      return Promise.resolve();
    }
    onWait();
    return new Promise<void>((resolve, reject) => {
      const queue = this.queues.get(stage) ?? [];
      this.queues.set(stage, queue);
      const waiter: Waiter = {
        grant: () => {
          signal.removeEventListener('abort', abort);
          resolve();
        },
      };
      const abort = (): void => {
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        reject(new CanceledError());
      };
      queue.push(waiter);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  private release(stage: Stage): void {
    const next = this.queues.get(stage)?.shift();
    if (next !== undefined) {
      next.grant();
      return;
    }
    this.busy.set(stage, Math.max(0, (this.busy.get(stage) ?? 1) - 1));
  }
}
