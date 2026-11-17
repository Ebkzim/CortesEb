import type { Clip } from '../contracts/cuts.js';
import type { Word } from '../contracts/media.js';
import type { LiveWindow } from './live-detector.js';

export interface CutRequest {
  id: string;
  window: LiveWindow;
  offset: number;
  duration: number;
  words: readonly Word[];
  bottom: 'video' | 'source';
  minWords: number;
}

export type CutOutcome = { ok: true; clip: Clip } | { ok: false; reason: string };

const BREAK_SECONDS = 0.35;
const START_REACH = 4;
const END_BEFORE = 3;
const END_AFTER = 5;
const HOOK_WORDS = 10;
const MAX_SCORE = 10;
const EDGE_PAD = 0.15;

export function buildLiveClip(request: CutRequest): CutOutcome {
  const { window, offset, duration } = request;
  const from = Math.max(0, window.start - offset);
  const to = Math.min(duration, window.end - offset);
  const peak = window.peakAt - offset;
  const spoken = request.words.filter(
    (word) => word.startMs / 1000 >= from && word.endMs / 1000 <= to,
  );
  if (spoken.length < request.minWords) {
    return { ok: false, reason: `pouca fala (${spoken.length} palavras)` };
  }
  const starts = sentenceStarts(request.words);
  const ends = sentenceEnds(request.words);
  const start = nearest(starts, from, START_REACH, START_REACH) ?? from;
  const floor = Math.max(start + 1, peak + 1);
  const end = Math.min(
    duration,
    nearest(
      ends.filter((value) => value >= floor),
      to,
      END_BEFORE,
      END_AFTER,
    ) ?? to,
  );
  if (end <= start) return { ok: false, reason: 'trecho vazio depois do ajuste' };
  const inside = request.words.filter(
    (word) => word.startMs / 1000 >= start && word.endMs / 1000 <= end,
  );
  const hook = inside
    .slice(0, HOOK_WORDS)
    .map((word) => word.text)
    .join(' ')
    .trim();
  const turns = peak > start + 2 && peak < end - 1 ? [Number(peak.toFixed(2))] : [];
  const clip: Clip = {
    id: request.id,
    start: Number(Math.max(0, start - EDGE_PAD).toFixed(2)),
    end: Number(Math.min(duration, end + EDGE_PAD).toFixed(2)),
    focus: { x: 50, y: 35 },
    bottom: request.bottom,
    pace: 'jump',
    turns,
    images: [],
    score: Math.min(MAX_SCORE, Math.max(0, Math.round(window.score))),
    ...(hook === '' ? {} : { hook: hook.slice(0, 500), title: hook.slice(0, 200) }),
  };
  return { ok: true, clip };
}

function sentenceStarts(words: readonly Word[]): number[] {
  const found: number[] = [];
  words.forEach((word, index) => {
    const before = words[index - 1];
    if (before === undefined || word.startMs - before.endMs >= BREAK_SECONDS * 1000) {
      found.push(word.startMs / 1000);
    }
  });
  return found;
}

function sentenceEnds(words: readonly Word[]): number[] {
  const found: number[] = [];
  words.forEach((word, index) => {
    const after = words[index + 1];
    if (after === undefined || after.startMs - word.endMs >= BREAK_SECONDS * 1000) {
      found.push(word.endMs / 1000);
    }
  });
  return found;
}

function nearest(
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
