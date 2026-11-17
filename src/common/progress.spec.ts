import { describe, expect, it } from 'vitest';
import { DownloadTracker, downloadPercent } from '../download/yt-dlp.js';
import { renderedSeconds } from '../render/ffmpeg/ffmpeg-engine.js';
import type { Output } from './output.js';
import { ProcessRunner } from './process-runner.js';
import {
  Progress,
  throttled,
  withProgress,
  type ProgressSink,
  type StepUpdate,
} from './progress.js';

function capture(): { output: Output; info: string[]; lines: string[] } {
  const info: string[] = [];
  const lines: string[] = [];
  const output = {
    info: (text: string) => info.push(text),
    line: (text: string) => lines.push(text),
  } as unknown as Output;
  return { output, info, lines };
}

describe('Progress', () => {
  it('prints steps to the terminal when no job is listening', () => {
    const { output, info, lines } = capture();
    const progress = new Progress(output);
    progress.step('render', 0.5, 'renderizando');
    progress.event('rendered', { id: 'a' });
    progress.event('clip', { id: 'b' }, true);
    expect(info).toEqual(['> renderizando']);
    expect(lines).toEqual(['{"event":"clip","id":"b"}']);
    expect(progress.active).toBe(false);
  });

  it('routes steps and events to the active job across awaits', async () => {
    const { output, info } = capture();
    const progress = new Progress(output);
    const steps: StepUpdate[] = [];
    const events: string[] = [];
    await withProgress(
      { step: (update) => steps.push(update), event: (name) => events.push(name) },
      async () => {
        expect(progress.active).toBe(true);
        await Promise.resolve();
        progress.step('download', 1.7, 'baixando');
        progress.event('rendered', {});
      },
    );
    expect(steps).toEqual([{ step: 'download', fraction: 1, message: 'baixando' }]);
    expect(events).toEqual(['rendered']);
    expect(info).toEqual([]);
  });

  it('keeps parallel jobs apart', async () => {
    const { output } = capture();
    const progress = new Progress(output);
    const a: string[] = [];
    const b: string[] = [];
    const sink = (list: string[]): ProgressSink => ({
      step: (update: StepUpdate) => list.push(update.message),
      event: () => undefined,
    });
    await Promise.all([
      withProgress(sink(a), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        progress.step('render', null, 'a');
      }),
      withProgress(sink(b), () => {
        progress.step('render', null, 'b');
        return Promise.resolve();
      }),
    ]);
    expect(a).toEqual(['a']);
    expect(b).toEqual(['b']);
  });

  it('throttles small changes but always reports the end', () => {
    const seen: number[] = [];
    const report = throttled((fraction) => seen.push(fraction), 0.1);
    for (const value of [0, 0.01, 0.05, 0.12, 0.15, 0.3, 1]) report(value);
    expect(seen).toEqual([0, 0.12, 0.3, 1]);
  });
});

describe('progress parsers', () => {
  it('reads the yt-dlp percent template', () => {
    expect(downloadPercent('[cortes]  45.3%')).toBe(45.3);
    expect(downloadPercent('[download] Destination: x.mp4')).toBeNull();
  });

  it('turns two download phases into one growing fraction', () => {
    const tracker = new DownloadTracker(2);
    expect(tracker.update(50)).toBeCloseTo(0.25);
    expect(tracker.update(100)).toBeCloseTo(0.5);
    expect(tracker.update(10)).toBeCloseTo(0.55);
    expect(tracker.update(100)).toBeCloseTo(1);
    expect(tracker.update(5)).toBeCloseTo(1);
  });

  it('reads ffmpeg progress output', () => {
    expect(renderedSeconds('out_time_us=2500000')).toBe(2.5);
    expect(renderedSeconds('frame=10')).toBeNull();
  });
});

describe('ProcessRunner lines', () => {
  it('delivers each output line while still capturing it', async () => {
    const lines: string[] = [];
    const result = await new ProcessRunner().run(
      process.execPath,
      [
        '-e',
        "process.stdout.write('a\\nb\\r'); process.stderr.write('c\\n'); process.stdout.write('d')",
      ],
      { onLine: (line) => lines.push(line) },
    );
    expect(result.code).toBe(0);
    expect(lines.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(result.stdout).toBe('a\nb\rd');
  });
});
