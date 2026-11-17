export interface ChatOptions {
  recentSeconds: number;
  baselineSeconds: number;
  minMessages: number;
  minBaseline: number;
  minRatio: number;
  dbPerDoubling: number;
  maxBoost: number;
}

export const CHAT_DEFAULTS: ChatOptions = {
  recentSeconds: 10,
  baselineSeconds: 300,
  minMessages: 10,
  minBaseline: 3,
  minRatio: 2,
  dbPerDoubling: 4,
  maxBoost: 12,
};

export class ChatCounter {
  private readonly config: ChatOptions;
  private readonly counts = new Map<number, number>();

  constructor(options: Partial<ChatOptions> = {}) {
    this.config = { ...CHAT_DEFAULTS, ...options };
  }

  add(time: number): void {
    const second = Math.floor(time);
    this.counts.set(second, (this.counts.get(second) ?? 0) + 1);
    const oldest = second - this.config.baselineSeconds - this.config.recentSeconds - 5;
    for (const key of this.counts.keys()) {
      if (key >= oldest) break;
      this.counts.delete(key);
    }
  }

  boost(time: number): number {
    const { recentSeconds, baselineSeconds, minMessages, minBaseline, minRatio } = this.config;
    const now = Math.floor(time);
    const recent = this.sum(now - recentSeconds + 1, now);
    if (recent < minMessages) return 0;
    const earlier = this.sum(now - recentSeconds - baselineSeconds + 1, now - recentSeconds);
    const baseline = Math.max(minBaseline, (earlier / baselineSeconds) * recentSeconds);
    const ratio = recent / baseline;
    if (ratio < minRatio) return 0;
    return Math.min(this.config.maxBoost, this.config.dbPerDoubling * Math.log2(ratio));
  }

  private sum(from: number, to: number): number {
    let total = 0;
    for (let second = from; second <= to; second += 1) total += this.counts.get(second) ?? 0;
    return total;
  }
}
