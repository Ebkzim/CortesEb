import type { Silence } from '../contracts/media.js';

export interface Span {
  from: number;
  to: number;
}

export interface Shot extends Span {
  turn: boolean;
}

export interface PlacedShot extends Shot {
  outStart: number;
  frames: number;
}

export interface SilenceOptions {
  minSilence: number;
  pad: number;
  minCut: number;
  minShot: number;
}

export const SILENCE_DEFAULTS: SilenceOptions = {
  minSilence: 0.5,
  pad: 0.12,
  minCut: 0.2,
  minShot: 0.3,
};

const SPLIT_HEAD_GUARD = 1.2;
const SPLIT_TAIL_GUARD = 1;
const SPLIT_STRETCH = 1.5;
const TURN_EDGE_GUARD = 0.3;
const TURN_TOLERANCE = 0.05;
const LOOKUP_TOLERANCE = 0.02;

export function removeSilences(
  range: Span,
  silences: readonly Silence[],
  options: SilenceOptions = SILENCE_DEFAULTS,
): Span[] {
  const ordered = [...silences].sort((a, b) => a.start - b.start);
  const spans: Span[] = [];
  let cursor = range.from;
  for (const silence of ordered) {
    const outside = silence.end <= range.from || silence.start >= range.to;
    if (outside || silence.end - silence.start < options.minSilence) continue;
    const cutFrom = Math.max(silence.start + options.pad, range.from);
    const cutTo = Math.min(silence.end - options.pad, range.to);
    if (cutTo - cutFrom < options.minCut) continue;
    if (cutFrom - cursor > options.minShot) spans.push({ from: cursor, to: cutFrom });
    cursor = Math.max(cursor, cutTo);
  }
  if (range.to - cursor > options.minShot) spans.push({ from: cursor, to: range.to });
  return spans.length > 0 ? spans : [{ from: range.from, to: range.to }];
}

export function splitLongShots(
  spans: readonly Span[],
  wordStarts: readonly number[],
  every: number,
): Span[] {
  if (every <= 0) return spans.map((span) => ({ ...span }));
  const result: Span[] = [];
  for (const span of spans) {
    let cursor = span.from;
    while (span.to - cursor > every * SPLIT_STRETCH) {
      const target = cursor + every;
      const candidate = closestTo(
        wordStarts.filter(
          (start) => start > cursor + SPLIT_HEAD_GUARD && start < span.to - SPLIT_TAIL_GUARD,
        ),
        target,
      );
      if (candidate === undefined) break;
      result.push({ from: cursor, to: candidate });
      cursor = candidate;
    }
    result.push({ from: cursor, to: span.to });
  }
  return result;
}

export function insertTurns(spans: readonly Span[], turns: readonly number[]): Span[] {
  const result = spans.map((span) => ({ ...span }));
  for (const turn of turns) {
    const index = result.findIndex(
      (span) => turn > span.from + TURN_EDGE_GUARD && turn < span.to - TURN_EDGE_GUARD,
    );
    const hit = result[index];
    if (hit === undefined) continue;
    result.splice(index, 1, { from: hit.from, to: turn }, { from: turn, to: hit.to });
  }
  return result;
}

export function markTurns(
  spans: readonly Span[],
  turns: readonly number[],
  everyCutIsTurn: boolean,
): Shot[] {
  return spans.map((span, index) => ({
    ...span,
    turn:
      index > 0 &&
      (everyCutIsTurn || turns.some((turn) => Math.abs(turn - span.from) < TURN_TOLERANCE)),
  }));
}

export function placeShots(shots: readonly Shot[], fps: number): PlacedShot[] {
  let elapsed = 0;
  return shots.map((shot) => {
    const frames = Math.max(1, Math.round((shot.to - shot.from) * fps));
    const placed = { ...shot, outStart: elapsed / fps, frames };
    elapsed += frames;
    return placed;
  });
}

export function totalSeconds(placed: readonly PlacedShot[], fps: number): number {
  return placed.reduce((sum, shot) => sum + shot.frames, 0) / fps;
}

export function findShot(placed: readonly PlacedShot[], time: number): PlacedShot | undefined {
  return placed.find((shot) => time >= shot.from - LOOKUP_TOLERANCE && time < shot.to);
}

export function toOutputTime(placed: readonly PlacedShot[], time: number): number {
  const shot = findShot(placed, time) ?? placed[placed.length - 1];
  if (shot === undefined) return 0;
  return Math.max(0, shot.outStart + (time - shot.from));
}

function closestTo(values: readonly number[], target: number): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (best === undefined || Math.abs(value - target) < Math.abs(best - target)) best = value;
  }
  return best;
}
