import { randomInt } from 'node:crypto';
import { z } from 'zod';

export function secondsRange(min: number, max: number): z.ZodType<SecondsRange> {
  return z
    .strictObject({
      minSeconds: z.number().int().min(min).max(max),
      maxSeconds: z.number().int().min(min).max(max),
    })
    .refine(
      (value) => value.maxSeconds >= value.minSeconds,
      'O máximo deve ser maior ou igual ao mínimo.',
    );
}

export interface SecondsRange {
  minSeconds: number;
  maxSeconds: number;
}

export function sampleSeconds(
  fixed: number,
  range?: SecondsRange | null,
  previous?: number | null,
): number {
  if (!range) return fixed;
  const { minSeconds: min, maxSeconds: max } = range;
  if (min === max) return min;
  if (previous === undefined || previous === null || previous < min || previous > max)
    return randomInt(min, max + 1);
  const value = randomInt(min, max);
  return value >= previous ? value + 1 : value;
}
