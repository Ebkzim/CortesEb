import { describe, expect, it } from 'vitest';
import { clipSchema, cutsSchema } from '../contracts/cuts.js';
import type { Word } from '../contracts/media.js';
import { paginate, remapWords, transcriptLines } from './captions.js';
import { bottomStartFor, cutInterval, planClip } from './plan.js';
import {
  insertTurns,
  markTurns,
  placeShots,
  removeSilences,
  splitLongShots,
  toOutputTime,
  totalSeconds,
} from './spans.js';

const word = (text: string, startMs: number, endMs: number): Word => ({ text, startMs, endMs });

describe('removeSilences', () => {
  it('keeps the range when there is no silence', () => {
    expect(removeSilences({ from: 10, to: 20 }, [])).toEqual([{ from: 10, to: 20 }]);
  });

  it('cuts long pauses leaving a pad on each side', () => {
    const spans = removeSilences({ from: 0, to: 10 }, [{ start: 4, end: 6 }]);
    expect(spans).toEqual([
      { from: 0, to: 4.12 },
      { from: 5.88, to: 10 },
    ]);
  });

  it('ignores short pauses and pauses outside the range', () => {
    const spans = removeSilences({ from: 0, to: 10 }, [
      { start: 2, end: 2.3 },
      { start: 12, end: 15 },
    ]);
    expect(spans).toEqual([{ from: 0, to: 10 }]);
  });

  it('sorts unordered silences', () => {
    const spans = removeSilences({ from: 0, to: 10 }, [
      { start: 7, end: 8 },
      { start: 2, end: 3 },
    ]);
    expect(spans.map((span) => span.from)).toEqual([0, 2.88, 7.88]);
  });
});

describe('splitLongShots', () => {
  it('returns the spans untouched when disabled', () => {
    expect(splitLongShots([{ from: 0, to: 30 }], [5, 10], 0)).toEqual([{ from: 0, to: 30 }]);
  });

  it('splits on the word start closest to the interval', () => {
    const spans = splitLongShots([{ from: 0, to: 9 }], [1.5, 2.9, 5.7, 8.5], 2.8);
    expect(spans).toEqual([
      { from: 0, to: 2.9 },
      { from: 2.9, to: 5.7 },
      { from: 5.7, to: 9 },
    ]);
  });

  it('keeps total duration', () => {
    const spans = splitLongShots([{ from: 3, to: 40 }], [5, 8, 11, 14, 20, 26, 33], 2.8);
    const sum = spans.reduce((acc, span) => acc + (span.to - span.from), 0);
    expect(sum).toBeCloseTo(37);
  });
});

describe('turns', () => {
  it('splits the span that contains the turn', () => {
    expect(insertTurns([{ from: 0, to: 10 }], [4])).toEqual([
      { from: 0, to: 4 },
      { from: 4, to: 10 },
    ]);
  });

  it('skips turns too close to an edge', () => {
    expect(insertTurns([{ from: 0, to: 10 }], [0.1, 9.9])).toEqual([{ from: 0, to: 10 }]);
  });

  it('marks only listed turns unless every cut is a turn', () => {
    const spans = [
      { from: 0, to: 4 },
      { from: 4, to: 7 },
      { from: 7, to: 10 },
    ];
    expect(markTurns(spans, [4], false).map((shot) => shot.turn)).toEqual([false, true, false]);
    expect(markTurns(spans, [], true).map((shot) => shot.turn)).toEqual([false, true, true]);
  });
});

describe('placeShots', () => {
  it('lays shots on a whole-frame timeline', () => {
    const placed = placeShots(
      [
        { from: 0, to: 1.01, turn: false },
        { from: 5, to: 6, turn: true },
      ],
      30,
    );
    expect(placed.map((shot) => shot.frames)).toEqual([30, 30]);
    expect(placed[1]?.outStart).toBe(1);
    expect(totalSeconds(placed, 30)).toBe(2);
  });

  it('maps source time to output time', () => {
    const placed = placeShots(
      [
        { from: 0, to: 1, turn: false },
        { from: 5, to: 6, turn: false },
      ],
      30,
    );
    expect(toOutputTime(placed, 5.5)).toBeCloseTo(1.5);
    expect(toOutputTime(placed, 99)).toBeCloseTo(95);
    expect(toOutputTime([], 3)).toBe(0);
  });
});

describe('captions', () => {
  const placed = placeShots(
    [
      { from: 0, to: 1, turn: false },
      { from: 5, to: 6, turn: false },
    ],
    30,
  );

  it('drops words removed with the pauses and shifts the rest', () => {
    const words = remapWords(
      [word('oi', 100, 400), word('fora', 2000, 2300), word('volta', 5200, 5500)],
      placed,
    );
    expect(words).toEqual([
      { text: 'OI', startMs: 100, endMs: 400 },
      { text: 'VOLTA', startMs: 1200, endMs: 1500 },
    ]);
  });

  it('groups up to three words and breaks on sentence end', () => {
    const pages = paginate([
      { text: 'A', startMs: 0, endMs: 100 },
      { text: 'B,', startMs: 100, endMs: 200 },
      { text: 'C', startMs: 200, endMs: 300 },
      { text: 'D.', startMs: 300, endMs: 400 },
      { text: 'E', startMs: 400, endMs: 500 },
    ]);
    expect(pages.map((page) => page.words.map((item) => item.text))).toEqual([
      ['A', 'B', 'C'],
      ['D.'],
      ['E'],
    ]);
    expect(pages[0]?.endMs).toBe(300);
    expect(pages[2]?.endMs).toBe(750);
  });

  it('breaks pages on long gaps and long text', () => {
    const pages = paginate([
      { text: 'EXTRAORDINARIAMENTE', startMs: 0, endMs: 100 },
      { text: 'GRANDE', startMs: 100, endMs: 200 },
      { text: 'X', startMs: 1000, endMs: 1100 },
    ]);
    expect(pages).toHaveLength(3);
  });

  it('prints transcript lines with a clock', () => {
    const lines = transcriptLines([
      word('Primeira', 0, 300),
      word('frase.', 300, 600),
      word('Depois', 65000, 65300),
    ]);
    expect(lines).toEqual(['[00:00] Primeira frase.', '[01:05] Depois']);
  });
});

describe('planClip', () => {
  const clip = clipSchema.parse({ id: '01-teste', start: 0, end: 12, turns: [6] });
  const words = [word('um', 500, 800), word('dois', 3000, 3300), word('três', 6000, 6300)];

  it('builds segments, pages and total from a clip', () => {
    const plan = planClip({
      clip,
      words,
      silences: [{ start: 8, end: 10 }],
      sourceDuration: 100,
      fps: 30,
    });
    expect(plan.segments.some((segment) => segment.turn)).toBe(true);
    expect(plan.totalSeconds).toBeCloseTo(10.24, 1);
    expect(plan.pages.flatMap((page) => page.words.map((item) => item.text))).toEqual([
      'UM',
      'DOIS',
      'TRÊS',
    ]);
  });

  it('clamps the clip to the source duration', () => {
    const plan = planClip({ clip, words, silences: [], sourceDuration: 5, fps: 30 });
    expect(plan.totalSeconds).toBeCloseTo(5);
  });

  it('resolves the cut interval from the pace', () => {
    expect(cutInterval(clip)).toBe(2.8);
    expect(cutInterval({ ...clip, pace: 'steady' })).toBe(0);
    expect(cutInterval({ ...clip, pace: 'flash' })).toBe(3.2);
    expect(cutInterval({ ...clip, cutEvery: 4 })).toBe(4);
  });

  it('spreads the bottom start and respects an explicit one', () => {
    expect(bottomStartFor(clip, 0, 100)).toBe(8);
    expect(bottomStartFor(clip, 1, 100)).toBe(25);
    expect(bottomStartFor({ ...clip, bottomStart: 400 }, 0, 100)).toBe(95);
    expect(bottomStartFor(clip, 0, 3)).toBe(0);
  });
});

describe('cuts contract', () => {
  it('rejects ids that could escape the output folder', () => {
    for (const id of ['../x', 'a/b', 'A', '', '.hidden', 'a b']) {
      expect(clipSchema.safeParse({ id, start: 0, end: 1 }).success).toBe(false);
    }
  });

  it('rejects inverted ranges, unknown keys and duplicate ids', () => {
    expect(clipSchema.safeParse({ id: 'a', start: 5, end: 5 }).success).toBe(false);
    expect(clipSchema.safeParse({ id: 'a', start: 0, end: 1, extra: 1 }).success).toBe(false);
    const duplicated = {
      clips: [
        { id: 'a', start: 0, end: 1 },
        { id: 'a', start: 2, end: 3 },
      ],
    };
    expect(cutsSchema.safeParse(duplicated).success).toBe(false);
  });

  it('applies defaults', () => {
    const parsed = clipSchema.parse({ id: 'a', start: 0, end: 1 });
    expect(parsed.focus).toEqual({ x: 50, y: 35 });
    expect(parsed.pace).toBe('jump');
    expect(parsed.turns).toEqual([]);
  });

  it('requires query or file on images', () => {
    expect(clipSchema.safeParse({ id: 'a', start: 0, end: 1, images: [{ at: 0 }] }).success).toBe(
      false,
    );
  });
});
