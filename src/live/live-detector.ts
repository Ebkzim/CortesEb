export interface LiveOptions {
  baselineSeconds: number;
  threshold: number;
  mergeGap: number;
  lead: number;
  tail: number;
  minSeconds: number;
  maxSeconds: number;
  warmup: number;
}

export interface LiveWindow {
  start: number;
  end: number;
  peakAt: number;
  score: number;
}

export const LIVE_DEFAULTS: LiveOptions = {
  baselineSeconds: 120,
  threshold: 6,
  mergeGap: 6,
  lead: 10,
  tail: 8,
  minSeconds: 20,
  maxSeconds: 60,
  warmup: 30,
};

const FLOOR_DB = -60;
const SMOOTH_SAMPLES = 3;
const MIN_KEPT_RATIO = 0.75;

interface OpenEvent {
  first: number;
  last: number;
  peakAt: number;
  peak: number;
  count: number;
}

export class LiveDetector {
  private readonly config: LiveOptions;
  private readonly levels: number[] = [];
  private readonly excess: number[] = [];
  private current: OpenEvent | null = null;
  private emittedUntil = 0;
  private seen = 0;
  private latest = 0;

  constructor(options: Partial<LiveOptions> = {}) {
    this.config = { ...LIVE_DEFAULTS, ...options };
  }

  push(time: number, level: number, boost = 0): LiveWindow[] {
    this.latest = time;
    const clamped = Math.max(FLOOR_DB, level);
    this.levels.push(clamped);
    if (this.levels.length > this.config.baselineSeconds) this.levels.shift();
    this.excess.push(clamped - median(this.levels) + boost);
    if (this.excess.length > SMOOTH_SAMPLES) this.excess.shift();
    this.seen += 1;
    if (this.seen <= this.config.warmup) return [];
    const smooth = this.excess.reduce((sum, value) => sum + value, 0) / this.excess.length;
    if (smooth >= this.config.threshold) this.register(time, smooth);
    return this.closeIfDone(time);
  }

  flush(): LiveWindow[] {
    if (this.current === null) return [];
    const window = this.toWindow(this.current, this.latest);
    this.current = null;
    return window === null ? [] : [window];
  }

  private register(time: number, value: number): void {
    const open = this.current;
    if (open === null) {
      this.current = { first: time, last: time, peakAt: time, peak: value, count: 1 };
      return;
    }
    open.last = time;
    open.count += 1;
    if (value > open.peak) {
      open.peak = value;
      open.peakAt = time;
    }
  }

  private closeIfDone(time: number): LiveWindow[] {
    const open = this.current;
    if (open === null) return [];
    const quiet = Math.max(this.config.tail, this.config.mergeGap) + 1;
    if (time - open.last < quiet) return [];
    this.current = null;
    const window = this.toWindow(open, time);
    return window === null ? [] : [window];
  }

  private toWindow(event: OpenEvent, available: number): LiveWindow | null {
    const { lead, tail, minSeconds, maxSeconds } = this.config;
    let start = Math.max(0, event.first - lead);
    let end = Math.min(available, event.last + 1 + tail);
    if (end - start > maxSeconds) {
      start = Math.max(0, event.peakAt - lead);
      end = Math.min(available, start + maxSeconds);
    }
    start = Math.max(start, this.emittedUntil);
    if (end - start < minSeconds) start = Math.max(this.emittedUntil, end - minSeconds);
    if (end - start < minSeconds * MIN_KEPT_RATIO) return null;
    this.emittedUntil = end;
    const score = event.peak + Math.log2(1 + event.count);
    return { start, end, peakAt: event.peakAt, score: Number(score.toFixed(2)) };
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
