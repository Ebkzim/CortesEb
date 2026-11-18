import { describe, expect, it } from 'vitest';
import { fitBetween, wavesFor } from './cut-pipeline.js';
import { StageGates } from './stage-gates.js';

function deferred(): { promise: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('StageGates', () => {
  it('lets one render at a time and queues the rest in order', async () => {
    const gates = new StageGates();
    const signal = new AbortController().signal;
    const order: string[] = [];
    const first = deferred();
    let waited = 0;
    const a = gates.run(
      'render',
      signal,
      () => (waited += 1),
      async () => {
        order.push('a');
        await first.promise;
      },
    );
    const b = gates.run(
      'render',
      signal,
      () => (waited += 1),
      () => {
        order.push('b');
        return Promise.resolve();
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['a']);
    expect(waited).toBe(1);
    first.open();
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  });

  it('runs several downloads together and drops a canceled waiter', async () => {
    const gates = new StageGates();
    const hold = deferred();
    const running: Promise<void>[] = [];
    let started = 0;
    for (let index = 0; index < 3; index += 1) {
      running.push(
        gates.run(
          'download',
          new AbortController().signal,
          () => undefined,
          async () => {
            started += 1;
            await hold.promise;
          },
        ),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toBe(3);
    const controller = new AbortController();
    const late = gates.run(
      'download',
      controller.signal,
      () => undefined,
      () => Promise.resolve(),
    );
    controller.abort();
    await expect(late).rejects.toThrow(/cancelada/);
    hold.open();
    await Promise.all(running);
    let after = false;
    await gates.run(
      'download',
      new AbortController().signal,
      () => undefined,
      () => {
        after = true;
        return Promise.resolve();
      },
    );
    expect(after).toBe(true);
  });
});

describe('waves', () => {
  it('keeps a short video in one piece', () => {
    expect(wavesFor(600, 30)).toEqual([{ from: 0, to: 600 }]);
  });

  it('splits a long video with a short first piece that skips the intro', () => {
    const waves = wavesFor(7200, 180);
    expect(waves[0]).toEqual({ from: 0, to: 480 });
    expect(waves[1]).toEqual({ from: 480, to: 1080 });
    expect(waves[waves.length - 1]?.to).toBe(7200);
    for (const [index, wave] of waves.entries()) {
      if (index > 0) expect(wave.from).toBe(waves[index - 1]?.to);
    }
  });

  it('never leaves a tiny last piece', () => {
    const waves = wavesFor(1200, 60);
    const last = waves[waves.length - 1];
    expect((last?.to ?? 0) - (last?.from ?? 0)).toBeGreaterThanOrEqual(300);
  });
});

describe('fitBetween', () => {
  const clip = (start: number, end: number): Parameters<typeof fitBetween>[0] => ({
    id: '01-a',
    start,
    end,
    focus: { x: 50, y: 35 },
    pace: 'jump',
    turns: [],
    images: [],
  });

  it('trims a clip that touches one already taken and drops what gets too short', () => {
    expect(fitBetween(clip(95, 140), [clip(60, 100)], 20)).toMatchObject({ start: 100, end: 140 });
    expect(fitBetween(clip(50, 90), [clip(80, 120)], 20)).toMatchObject({ start: 50, end: 80 });
    expect(fitBetween(clip(90, 105), [clip(60, 100)], 20)).toBeNull();
  });
});
