import { describe, expect, it } from 'vitest';
import { StepTracker, type StepState } from './step-tracker.js';

function tracker(): { steps: StepTracker; seen: StepState[][]; tick: (seconds: number) => void } {
  let now = Date.parse('2026-11-17T10:00:00.000Z');
  const seen: StepState[][] = [];
  const steps = new StepTracker(
    ['download', 'transcribe', 'render'],
    (snapshot) => seen.push(snapshot),
    () => now,
  );
  return {
    steps,
    seen,
    tick: (seconds) => {
      now += seconds * 1000;
    },
  };
}

describe('StepTracker', () => {
  it('moves steps through their states and reports each change', () => {
    const { steps, seen } = tracker();
    steps.start('download', 'iniciando');
    steps.update('download', 0.5, 'baixando 50%');
    steps.finish('download');
    steps.skip('transcribe', 'legenda pronta');
    const last = seen[seen.length - 1] ?? [];
    expect(last.map((step) => step.status)).toEqual(['done', 'skipped', 'pending']);
    expect(last[0]?.fraction).toBe(1);
    expect(last[0]?.label).toBe('Baixando o vídeo');
  });

  it('estimates the time left from the progress rate', () => {
    const { steps, tick } = tracker();
    steps.start('download');
    tick(30);
    steps.update('download', 0.25, '25%');
    expect(steps.snapshot()[0]?.remainingSeconds).toBe(90);
  });

  it('falls back to the static estimate before there is progress', () => {
    const { steps, tick } = tracker();
    steps.estimate('download', 100);
    steps.estimate('transcribe', 40);
    steps.estimate('render', 60);
    expect(steps.totalRemaining()).toBe(200);
    steps.start('download');
    tick(30);
    expect(steps.snapshot()[0]?.remainingSeconds).toBe(70);
    expect(steps.totalRemaining()).toBe(170);
  });

  it('cannot estimate while waiting for the user or with unknown steps', () => {
    const { steps } = tracker();
    steps.estimate('download', 10);
    steps.estimate('render', 10);
    expect(steps.totalRemaining()).toBeNull();
    steps.estimate('transcribe', 10);
    steps.wait('transcribe', 'esperando');
    expect(steps.totalRemaining()).toBeNull();
  });

  it('marks the active step as failed and ignores unknown steps', () => {
    const { steps } = tracker();
    steps.start('download');
    steps.update('select', 0.5, 'não existe');
    steps.fail('rede caiu');
    expect(steps.snapshot()[0]).toMatchObject({ status: 'failed', message: 'rede caiu' });
    expect(steps.has('select')).toBe(false);
  });

  it('starts a pending step on its first update and clamps fractions', () => {
    const { steps } = tracker();
    steps.update('render', 3, 'renderizando');
    expect(steps.snapshot()[2]).toMatchObject({ status: 'running', fraction: 1 });
  });
});
