import type { Word } from '../contracts/media.js';

export const BREAK_SECONDS = 0.35;

export function sentenceStarts(words: readonly Word[]): number[] {
  const found: number[] = [];
  words.forEach((word, index) => {
    const before = words[index - 1];
    if (before === undefined || word.startMs - before.endMs >= BREAK_SECONDS * 1000) {
      found.push(word.startMs / 1000);
    }
  });
  return found;
}

export function sentenceEnds(words: readonly Word[]): number[] {
  const found: number[] = [];
  words.forEach((word, index) => {
    const after = words[index + 1];
    if (after === undefined || after.startMs - word.endMs >= BREAK_SECONDS * 1000) {
      found.push(word.endMs / 1000);
    }
  });
  return found;
}

export function nearest(
  values: readonly number[],
  target: number,
  before: number,
  after: number,
): number | null {
  let best: number | null = null;
  for (const value of values) {
    if (value < target - before || value > target + after) continue;
    if (best === null || Math.abs(value - target) < Math.abs(best - target)) best = value;
  }
  return best;
}
