import type { Word } from '../contracts/media.js';
import type { CaptionPage, RenderWord } from '../contracts/render.js';
import { findShot, type PlacedShot } from './spans.js';

export interface PageOptions {
  maxWords: number;
  maxChars: number;
  maxGapMs: number;
  holdMs: number;
}

export const PAGE_DEFAULTS: PageOptions = {
  maxWords: 3,
  maxChars: 20,
  maxGapMs: 600,
  holdMs: 250,
};

const MIN_WORD_SECONDS = 0.12;
const SENTENCE_END = /[.!?…]$/;
const SOFT_PUNCTUATION = /[,;:]$/;

export function remapWords(words: readonly Word[], placed: readonly PlacedShot[]): RenderWord[] {
  const result: RenderWord[] = [];
  for (const word of words) {
    const start = word.startMs / 1000;
    const shot = findShot(placed, start);
    if (shot === undefined) continue;
    const length = Math.max(MIN_WORD_SECONDS, (word.endMs - word.startMs) / 1000);
    const outStart = shot.outStart + Math.max(0, start - shot.from);
    const outEnd = Math.min(shot.outStart + (shot.to - shot.from), outStart + length);
    result.push({
      text: word.text.toUpperCase(),
      startMs: Math.round(outStart * 1000),
      endMs: Math.round(outEnd * 1000),
    });
  }
  return result;
}

export function paginate(
  words: readonly RenderWord[],
  options: PageOptions = PAGE_DEFAULTS,
): CaptionPage[] {
  const groups: RenderWord[][] = [];
  let current: RenderWord[] = [];
  const flush = (): void => {
    if (current.length > 0) groups.push(current);
    current = [];
  };
  for (const word of words) {
    const previous = current[current.length - 1];
    const gap = previous === undefined ? 0 : word.startMs - previous.endMs;
    const chars = current.reduce((sum, item) => sum + item.text.length, 0) + word.text.length;
    if (current.length >= options.maxWords || chars > options.maxChars || gap > options.maxGapMs) {
      flush();
    }
    current.push(word);
    if (SENTENCE_END.test(word.text)) flush();
  }
  flush();

  return groups.map((group, index) => {
    const first = group[0];
    const last = group[group.length - 1];
    const next = groups[index + 1]?.[0];
    const startMs = first?.startMs ?? 0;
    const naturalEnd = (last?.endMs ?? startMs) + options.holdMs;
    return {
      words: group.map((word) => ({ ...word, text: word.text.replace(SOFT_PUNCTUATION, '') })),
      startMs,
      endMs: next === undefined ? naturalEnd : Math.min(next.startMs, naturalEnd),
    };
  });
}

export function transcriptLines(words: readonly Word[], maxWords = 28, maxGapMs = 900): string[] {
  const lines: string[] = [];
  let line: string[] = [];
  let lineStart = 0;
  let previous: Word | undefined;
  const flush = (): void => {
    if (line.length > 0) lines.push(`[${clock(lineStart)}] ${line.join(' ')}`);
    line = [];
  };
  for (const word of words) {
    if (line.length > 0 && previous !== undefined && word.startMs - previous.endMs > maxGapMs) {
      flush();
    }
    if (line.length === 0) lineStart = word.startMs;
    line.push(word.text);
    if (SENTENCE_END.test(word.text) || line.length >= maxWords) flush();
    previous = word;
  }
  flush();
  return lines;
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return `${minutes}:${secs}`;
}
