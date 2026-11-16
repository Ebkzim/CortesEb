import type { Clip } from '../contracts/cuts.js';
import type { Silence, Word } from '../contracts/media.js';
import type { CaptionPage, RenderSegment } from '../contracts/render.js';
import { paginate, remapWords } from './captions.js';
import {
  insertTurns,
  markTurns,
  placeShots,
  removeSilences,
  splitLongShots,
  totalSeconds,
  type PlacedShot,
} from './spans.js';

export interface PlanInput {
  clip: Clip;
  words: readonly Word[];
  silences: readonly Silence[];
  sourceDuration: number;
  fps: number;
}

export interface ClipPlan {
  placed: PlacedShot[];
  segments: RenderSegment[];
  pages: CaptionPage[];
  totalSeconds: number;
}

const JUMP_EVERY = 2.8;
const FLASH_EVERY = 3.2;
const BOTTOM_TAIL = 5;
const BOTTOM_OFFSET = 8;
const BOTTOM_STEP = 17;

export function cutInterval(clip: Clip): number {
  if (clip.pace === 'steady') return 0;
  return clip.cutEvery ?? (clip.pace === 'flash' ? FLASH_EVERY : JUMP_EVERY);
}

export function planClip(input: PlanInput): ClipPlan {
  const { clip, words, silences, sourceDuration, fps } = input;
  const range = { from: Math.max(0, clip.start), to: Math.min(sourceDuration, clip.end) };
  const wordStarts = words.map((word) => word.startMs / 1000);
  const spoken = removeSilences(range, silences);
  const split = splitLongShots(spoken, wordStarts, cutInterval(clip));
  const spans = insertTurns(split, clip.turns);
  const placed = placeShots(markTurns(spans, clip.turns, clip.pace === 'flash'), fps);
  return {
    placed,
    segments: placed.map(({ from, to, turn }) => ({ from, to, turn })),
    pages: paginate(remapWords(words, placed)),
    totalSeconds: totalSeconds(placed, fps),
  };
}

export function bottomStartFor(clip: Clip, index: number, bottomDuration: number): number {
  const usable = Math.max(0, bottomDuration - BOTTOM_TAIL);
  const spread = (BOTTOM_OFFSET + index * BOTTOM_STEP) % Math.max(1, bottomDuration - BOTTOM_TAIL);
  return Math.min(clip.bottomStart ?? spread, usable);
}
