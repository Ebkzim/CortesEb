import { describe, expect, it } from 'vitest';
import { findPeakWindows, parseRmsLevels } from './loudness.js';

const flat = (seconds: number, level = -35): number[] =>
  Array.from({ length: seconds }, () => level);

describe('parseRmsLevels', () => {
  it('reads the rms level lines and maps -inf to silence', () => {
    const log = [
      'frame:0 pts:0 pts_time:0',
      'lavfi.astats.Overall.RMS_level=-31.25',
      'frame:1 pts:16000 pts_time:1',
      'lavfi.astats.Overall.RMS_level=-inf',
      'lavfi.astats.Overall.RMS_level=-48.1',
    ].join('\n');
    expect(parseRmsLevels(log)).toEqual([-31.25, -90, -48.1]);
  });

  it('returns nothing for an empty log', () => {
    expect(parseRmsLevels('')).toEqual([]);
  });
});

describe('findPeakWindows', () => {
  it('finds a loud burst and pads it with lead and tail', () => {
    const levels = flat(300);
    for (let second = 150; second < 156; second += 1) levels[second] = -15;
    const [window] = findPeakWindows(levels);
    expect(window).toBeDefined();
    expect(window?.peakAt).toBeGreaterThanOrEqual(150);
    expect(window?.peakAt).toBeLessThan(156);
    expect(window?.start).toBeLessThanOrEqual(140);
    expect(window?.end).toBeGreaterThanOrEqual(170);
    expect(window?.score).toBeGreaterThan(6);
  });

  it('ranks the louder burst first and keeps windows apart', () => {
    const levels = flat(600);
    for (let second = 100; second < 104; second += 1) levels[second] = -22;
    for (let second = 400; second < 404; second += 1) levels[second] = -10;
    const windows = findPeakWindows(levels);
    expect(windows).toHaveLength(2);
    expect(windows[0]?.peakAt).toBeGreaterThanOrEqual(400);
    expect(windows[1]?.peakAt).toBeLessThan(110);
  });

  it('merges bursts that are close together into one window', () => {
    const levels = flat(300);
    for (const second of [100, 101, 106, 107]) levels[second] = -14;
    expect(findPeakWindows(levels)).toHaveLength(1);
  });

  it('caps window length and respects the top limit', () => {
    const levels = flat(900);
    for (let second = 100; second < 400; second += 1) levels[second] = -12;
    const [long] = findPeakWindows(levels, { maxSeconds: 60 });
    expect((long?.end ?? 0) - (long?.start ?? 0)).toBeLessThanOrEqual(60);
    const many = flat(2000);
    for (let burst = 0; burst < 12; burst += 1) {
      for (let second = 0; second < 3; second += 1) many[100 + burst * 150 + second] = -12;
    }
    expect(findPeakWindows(many, { top: 4 })).toHaveLength(4);
  });

  it('ignores a steadily loud stream and empty input', () => {
    expect(findPeakWindows(flat(400, -12))).toEqual([]);
    expect(findPeakWindows([])).toEqual([]);
  });

  it('keeps windows inside the recording', () => {
    const levels = flat(60);
    for (let second = 2; second < 5; second += 1) levels[second] = -10;
    const [window] = findPeakWindows(levels);
    expect(window?.start).toBe(0);
    expect(window?.end).toBeLessThanOrEqual(60);
  });
});
