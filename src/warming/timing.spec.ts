import { describe, expect, it } from 'vitest';
import { sampleSeconds } from './timing.js';
import { warmingConfigSchema } from './warming-state.js';
import { followingConfigSchema } from '../following/following-state.js';

describe('variable timing', () => {
  it('keeps legacy sessions fixed until a range is explicitly enabled', () => {
    const old = warmingConfigSchema.parse({ watchSeconds: 20, intervalSeconds: 60 });
    expect(old.watchRange).toBeNull();
    expect(old.intervalRange).toBeNull();
    expect(sampleSeconds(old.watchSeconds, old.watchRange)).toBe(20);
  });
  it('draws an inclusive integer and avoids repeating the previous value', () => {
    let previous: number | null = null;
    const observed = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const next = sampleSeconds(60, { minSeconds: 10, maxSeconds: 11 }, previous);
      expect([10, 11]).toContain(next);
      expect(next).not.toBe(previous);
      observed.add(next);
      previous = next;
    }
    expect([...observed].sort()).toEqual([10, 11]);
    expect(sampleSeconds(60, { minSeconds: 43, maxSeconds: 43 }, 43)).toBe(43);
  });
  it('rejects inverted, fractional and out-of-bounds ranges', () => {
    for (const watchRange of [
      { minSeconds: 30, maxSeconds: 10 },
      { minSeconds: 4, maxSeconds: 20 },
      { minSeconds: 5.5, maxSeconds: 121 },
    ])
      expect(warmingConfigSchema.safeParse({ watchRange }).success).toBe(false);
    expect(
      followingConfigSchema.safeParse({ interval: { minSeconds: 60, maxSeconds: 30 } }).success,
    ).toBe(false);
    expect(followingConfigSchema.safeParse({ mode: 'both' }).success).toBe(false);
    expect(followingConfigSchema.safeParse({ goal: 0 }).success).toBe(false);
  });
});
