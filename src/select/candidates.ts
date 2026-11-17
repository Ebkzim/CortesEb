import type { Clip } from '../contracts/cuts.js';
import type { Word } from '../contracts/media.js';
import { nearest, sentenceEnds, sentenceStarts } from '../timeline/boundaries.js';
import type { Candidate } from './prompt.js';

export interface Limits {
  minSeconds: number;
  maxSeconds: number;
  total: number;
}

export interface Picked extends Candidate {
  start: number;
  end: number;
}

const START_REACH = 3;
const END_BEFORE = 3;
const END_AFTER = 5;
const TOLERANCE_LOW = 0.7;
const TOLERANCE_HIGH = 1.3;
const EDGE_PAD = 0.15;
const SLUG_LIMIT = 40;

export function usable(candidate: Candidate, limits: Limits): Candidate | null {
  const start = Math.max(0, Math.min(candidate.start, limits.total));
  const end = Math.max(0, Math.min(candidate.end, limits.total));
  const length = end - start;
  if (length < limits.minSeconds * TOLERANCE_LOW) return null;
  if (length > limits.maxSeconds * TOLERANCE_HIGH) return null;
  return { ...candidate, start, end };
}

export function pickBest(
  candidates: readonly Candidate[],
  count: number,
  minScore: number,
): Candidate[] {
  const ranked = [...candidates]
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const candidate of ranked) {
    if (kept.some((other) => candidate.start < other.end && other.start < candidate.end)) continue;
    kept.push(candidate);
    if (kept.length >= count) break;
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function snap(candidate: Candidate, words: readonly Word[], limits: Limits): Picked {
  const start =
    nearest(sentenceStarts(words), candidate.start, START_REACH, START_REACH) ?? candidate.start;
  const floor = start + limits.minSeconds * TOLERANCE_LOW;
  const ceiling = start + limits.maxSeconds;
  const ends = sentenceEnds(words).filter((value) => value >= floor && value <= ceiling);
  const wanted = Math.min(candidate.end, ceiling);
  const end = nearest(ends, wanted, END_BEFORE, END_AFTER) ?? wanted;
  return { ...candidate, start, end: Math.min(limits.total, end) };
}

export function toClip(picked: Picked, index: number, total: number): Clip {
  return {
    id: `${String(index + 1).padStart(2, '0')}-${slug(picked.title)}`,
    start: Number(Math.max(0, picked.start - EDGE_PAD).toFixed(2)),
    end: Number(Math.min(total, picked.end + EDGE_PAD).toFixed(2)),
    focus: { x: 50, y: 35 },
    bottom: 'video',
    pace: 'jump',
    turns: [],
    images: [],
    score: Math.round(picked.score),
    hook: picked.hook.slice(0, 500),
    title: picked.title.slice(0, 200),
    ...(picked.topic === undefined || picked.topic === '' ? {} : { topic: picked.topic }),
  };
}

export function slug(text: string): string {
  const base = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/g, '');
  return base === '' ? 'corte' : base;
}
