import { describe, expect, it } from 'vitest';
import { deriveTargets } from './clip-targets.js';

describe('deriveTargets', () => {
  it('derives the count from a duration range', () => {
    const targets = deriveTargets({ sourceSeconds: 1200, minSeconds: 30, maxSeconds: 50 });
    expect(targets).toMatchObject({ mode: 'duration', count: 15, minSeconds: 30, maxSeconds: 50 });
  });

  it('caps the derived count and never goes below one', () => {
    expect(deriveTargets({ sourceSeconds: 7200, minSeconds: 15, maxSeconds: 25 }).count).toBe(20);
    expect(deriveTargets({ sourceSeconds: 70, minSeconds: 40, maxSeconds: 60 }).count).toBe(1);
  });

  it('fills the missing end of a range', () => {
    expect(deriveTargets({ sourceSeconds: 1200, maxSeconds: 50 })).toMatchObject({
      minSeconds: 30,
      maxSeconds: 50,
    });
    expect(deriveTargets({ sourceSeconds: 1200, minSeconds: 30 })).toMatchObject({
      minSeconds: 30,
      maxSeconds: 50,
    });
  });

  it('derives the duration range from a count', () => {
    expect(deriveTargets({ sourceSeconds: 1200, count: 10 })).toMatchObject({
      mode: 'count',
      count: 10,
      minSeconds: 36,
      maxSeconds: 60,
    });
    expect(deriveTargets({ sourceSeconds: 1200, count: 3 })).toMatchObject({
      minSeconds: 54,
      maxSeconds: 90,
    });
    expect(deriveTargets({ sourceSeconds: 300, count: 10 })).toMatchObject({
      minSeconds: 12,
      maxSeconds: 20,
    });
  });

  it('accepts count and range together when they fit', () => {
    const targets = deriveTargets({ sourceSeconds: 600, count: 4, minSeconds: 20, maxSeconds: 40 });
    expect(targets).toMatchObject({ mode: 'both', count: 4, minSeconds: 20, maxSeconds: 40 });
  });

  it('falls back to defaults sized by the video', () => {
    expect(deriveTargets({ sourceSeconds: 3600 })).toMatchObject({
      mode: 'auto',
      count: 5,
      minSeconds: 20,
      maxSeconds: 60,
    });
    expect(deriveTargets({ sourceSeconds: 240 }).count).toBe(2);
    expect(deriveTargets({ sourceSeconds: 100 }).count).toBe(1);
  });

  it('rejects requests the video cannot satisfy', () => {
    const impossible = [
      { sourceSeconds: 100, count: 20 },
      { sourceSeconds: 100, count: 4, minSeconds: 30, maxSeconds: 40 },
      { sourceSeconds: 600, minSeconds: 50, maxSeconds: 40 },
      { sourceSeconds: 600, minSeconds: 5, maxSeconds: 40 },
      { sourceSeconds: 600, minSeconds: 30, maxSeconds: 400 },
      { sourceSeconds: 600, count: 0 },
      { sourceSeconds: 600, count: 21 },
      { sourceSeconds: 600, count: 2.5 },
      { sourceSeconds: 15 },
    ];
    for (const request of impossible) {
      expect(() => deriveTargets(request), JSON.stringify(request)).toThrow();
    }
  });
});
