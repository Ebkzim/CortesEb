import { z } from 'zod';
import { AppError } from '../common/app-error.js';

export const MIN_CLIP_SECONDS = 10;
export const MAX_CLIP_SECONDS = 180;
export const MAX_CLIP_COUNT = 20;

const DEFAULT_MIN_SECONDS = 20;
const DEFAULT_MAX_SECONDS = 60;
const DEFAULT_MAX_COUNT = 5;
const SHORT_VIDEO_SECONDS = 300;
const COVERAGE = 0.5;
const MIN_RATIO = 0.6;

export const targetsSchema = z.strictObject({
  mode: z.enum(['duration', 'count', 'both', 'auto']),
  sourceSeconds: z.number().positive(),
  count: z.number().int().min(1).max(MAX_CLIP_COUNT),
  minSeconds: z.number().min(MIN_CLIP_SECONDS).max(MAX_CLIP_SECONDS),
  maxSeconds: z.number().min(MIN_CLIP_SECONDS).max(MAX_CLIP_SECONDS),
});

export type ClipTargets = z.infer<typeof targetsSchema>;

export interface TargetsRequest {
  sourceSeconds: number;
  minSeconds?: number;
  maxSeconds?: number;
  count?: number;
}

export function deriveTargets(request: TargetsRequest): ClipTargets {
  const { sourceSeconds, count } = request;
  const hasRange = request.minSeconds !== undefined || request.maxSeconds !== undefined;
  if (count !== undefined && !hasRange) return fromCount(sourceSeconds, count);
  const range = resolveRange(request);
  if (count !== undefined) {
    assertFits(sourceSeconds, count, range.minSeconds);
    return { mode: 'both', sourceSeconds, count, ...range };
  }
  const fitting = Math.floor((sourceSeconds * COVERAGE) / average(range));
  if (hasRange) {
    const derived = clamp(fitting, 1, MAX_CLIP_COUNT);
    assertFits(sourceSeconds, derived, range.minSeconds);
    return { mode: 'duration', sourceSeconds, count: derived, ...range };
  }
  const ceiling = sourceSeconds < SHORT_VIDEO_SECONDS ? 2 : DEFAULT_MAX_COUNT;
  const derived = clamp(fitting, 1, ceiling);
  assertFits(sourceSeconds, derived, range.minSeconds);
  return { mode: 'auto', sourceSeconds, count: derived, ...range };
}

function fromCount(sourceSeconds: number, count: number): ClipTargets {
  assertFits(sourceSeconds, count, MIN_CLIP_SECONDS);
  const budget = Math.floor((sourceSeconds * COVERAGE) / count);
  const maxSeconds = clamp(budget, DEFAULT_MIN_SECONDS, DEFAULT_MAX_SECONDS + 30);
  const fitted = Math.min(maxSeconds, Math.floor(sourceSeconds / count));
  const upper = Math.max(MIN_CLIP_SECONDS, fitted);
  const minSeconds = Math.max(MIN_CLIP_SECONDS, Math.round(upper * MIN_RATIO));
  return { mode: 'count', sourceSeconds, count, minSeconds, maxSeconds: upper };
}

function resolveRange(request: TargetsRequest): { minSeconds: number; maxSeconds: number } {
  if (request.minSeconds === undefined && request.maxSeconds === undefined) {
    return { minSeconds: DEFAULT_MIN_SECONDS, maxSeconds: DEFAULT_MAX_SECONDS };
  }
  const minSeconds =
    request.minSeconds ??
    (request.maxSeconds === undefined
      ? DEFAULT_MIN_SECONDS
      : Math.max(MIN_CLIP_SECONDS, Math.round(request.maxSeconds * MIN_RATIO)));
  const maxSeconds =
    request.maxSeconds ?? Math.min(MAX_CLIP_SECONDS, Math.round(minSeconds / MIN_RATIO));
  if (minSeconds < MIN_CLIP_SECONDS || maxSeconds > MAX_CLIP_SECONDS) {
    throw new AppError(
      'INVALID_INPUT',
      `a duração dos cortes vai de ${MIN_CLIP_SECONDS} a ${MAX_CLIP_SECONDS} s`,
    );
  }
  if (minSeconds > maxSeconds) {
    throw new AppError('INVALID_INPUT', 'a duração mínima é maior que a máxima');
  }
  return { minSeconds, maxSeconds };
}

function assertFits(sourceSeconds: number, count: number, minSeconds: number): void {
  if (count < 1 || count > MAX_CLIP_COUNT || !Number.isInteger(count)) {
    throw new AppError('INVALID_INPUT', `a quantidade vai de 1 a ${MAX_CLIP_COUNT} cortes`);
  }
  if (count * minSeconds > sourceSeconds) {
    const fits = Math.floor(sourceSeconds / minSeconds);
    throw new AppError(
      'INVALID_INPUT',
      `o vídeo tem ${Math.floor(sourceSeconds)} s: cabem no máximo ${fits} cortes de ${minSeconds} s`,
    );
  }
}

function average(range: { minSeconds: number; maxSeconds: number }): number {
  return (range.minSeconds + range.maxSeconds) / 2;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
