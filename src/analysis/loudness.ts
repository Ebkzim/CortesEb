export interface PeakOptions {
  baselineSeconds: number;
  threshold: number;
  mergeGap: number;
  lead: number;
  tail: number;
  minSeconds: number;
  maxSeconds: number;
  top: number;
}

export interface PeakWindow {
  start: number;
  end: number;
  peakAt: number;
  score: number;
}

export const PEAK_DEFAULTS: PeakOptions = {
  baselineSeconds: 120,
  threshold: 6,
  mergeGap: 8,
  lead: 12,
  tail: 15,
  minSeconds: 20,
  maxSeconds: 90,
  top: 10,
};

const FLOOR_DB = -60;
const SILENT_DB = -90;
const SMOOTH_RADIUS = 1;
const MAX_OVERLAP = 0.3;
const RMS_LINE = /lavfi\.astats\.Overall\.RMS_level=(-?inf|-?[0-9.]+)/g;

export function parseRmsLevels(log: string): number[] {
  const levels: number[] = [];
  for (const match of log.matchAll(RMS_LINE)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const value = raw.includes('inf') ? SILENT_DB : Number(raw);
    levels.push(Number.isFinite(value) ? value : SILENT_DB);
  }
  return levels;
}

export function findPeakWindows(
  levels: readonly number[],
  options: Partial<PeakOptions> = {},
): PeakWindow[] {
  const config = { ...PEAK_DEFAULTS, ...options };
  if (levels.length === 0) return [];
  const clamped = levels.map((level) => Math.max(FLOOR_DB, level));
  const baseline = rollingMedian(clamped, config.baselineSeconds);
  const excess = clamped.map((level, index) => level - (baseline[index] ?? level));
  const smooth = excess.map((_, index) =>
    average(excess, index - SMOOTH_RADIUS, index + SMOOTH_RADIUS),
  );
  const seeds: number[] = [];
  smooth.forEach((value, index) => {
    if (value >= config.threshold) seeds.push(index);
  });
  const windows = group(seeds, config.mergeGap).map((events) =>
    toWindow(events, smooth, levels.length, config),
  );
  return suppressOverlaps(
    windows.sort((a, b) => b.score - a.score),
    config.top,
  );
}

function group(seeds: readonly number[], gap: number): number[][] {
  const groups: number[][] = [];
  for (const seed of seeds) {
    const current = groups[groups.length - 1];
    const last = current?.[current.length - 1];
    if (current !== undefined && last !== undefined && seed - last <= gap) current.push(seed);
    else groups.push([seed]);
  }
  return groups;
}

function toWindow(
  events: readonly number[],
  smooth: readonly number[],
  total: number,
  config: PeakOptions,
): PeakWindow {
  let peakAt = events[0] ?? 0;
  for (const index of events) {
    if ((smooth[index] ?? 0) > (smooth[peakAt] ?? 0)) peakAt = index;
  }
  const first = events[0] ?? peakAt;
  const last = events[events.length - 1] ?? peakAt;
  let start = Math.max(0, first - config.lead);
  let end = Math.min(total, last + 1 + config.tail);
  if (end - start > config.maxSeconds) {
    start = Math.max(0, peakAt - config.lead);
    end = Math.min(total, start + config.maxSeconds);
  }
  if (end - start < config.minSeconds) {
    end = Math.min(total, start + config.minSeconds);
    start = Math.max(0, end - config.minSeconds);
  }
  const score = (smooth[peakAt] ?? 0) + Math.log2(1 + events.length);
  return { start, end, peakAt, score: Number(score.toFixed(2)) };
}

function suppressOverlaps(ranked: readonly PeakWindow[], top: number): PeakWindow[] {
  const kept: PeakWindow[] = [];
  for (const window of ranked) {
    const clash = kept.some((other) => overlap(window, other) > MAX_OVERLAP);
    if (!clash) kept.push(window);
    if (kept.length >= top) break;
  }
  return kept;
}

function overlap(a: PeakWindow, b: PeakWindow): number {
  const shared = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (shared <= 0) return 0;
  return shared / Math.min(a.end - a.start, b.end - b.start);
}

function rollingMedian(values: readonly number[], width: number): number[] {
  const half = Math.max(1, Math.floor(width / 2));
  return values.map((_, index) => {
    const slice = values.slice(
      Math.max(0, index - half),
      Math.min(values.length, index + half + 1),
    );
    const sorted = [...slice].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  });
}

function average(values: readonly number[], from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (let index = Math.max(0, from); index <= Math.min(values.length - 1, to); index += 1) {
    sum += values[index] ?? 0;
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}
