import { z } from 'zod';

const seconds = z.number().nonnegative();
const millis = z.number().nonnegative();

export const wordSchema = z.strictObject({
  text: z.string().min(1).max(200),
  startMs: millis,
  endMs: millis,
});

export const captionsSchema = z.array(wordSchema);

export const silenceSchema = z.strictObject({
  start: seconds,
  end: seconds,
});

export const silencesSchema = z.array(silenceSchema);

export const sourceMetaSchema = z.strictObject({
  duration: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.string().min(1).max(32),
});

export type Word = z.infer<typeof wordSchema>;
export type Silence = z.infer<typeof silenceSchema>;
export type SourceMeta = z.infer<typeof sourceMetaSchema>;
