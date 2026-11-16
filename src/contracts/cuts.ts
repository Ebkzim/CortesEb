import { z } from 'zod';

const seconds = z.number().nonnegative();
const percent = z.number().min(0).max(100);

export const CLIP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ACCOUNT_REF_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const focusSchema = z.strictObject({ x: percent, y: percent });

export const cropSchema = z.strictObject({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  w: z.number().positive(),
  h: z.number().positive(),
});

export const paceSchema = z.enum(['jump', 'steady', 'flash']);

export const clipImageSchema = z
  .strictObject({
    query: z.string().trim().min(1).max(200).optional(),
    file: z.string().min(1).max(1024).optional(),
    at: seconds,
    dur: z.number().positive().max(15).optional(),
  })
  .refine((image) => image.query !== undefined || image.file !== undefined, {
    message: 'image needs query or file',
  });

export const clipSchema = z
  .strictObject({
    id: z.string().regex(CLIP_ID_PATTERN),
    start: seconds,
    end: seconds,
    focus: focusSchema.default({ x: 50, y: 35 }),
    crop: cropSchema.optional(),
    bottomStart: seconds.optional(),
    pace: paceSchema.default('jump'),
    cutEvery: z.number().min(0).max(30).optional(),
    turns: z.array(seconds).max(20).default([]),
    images: z.array(clipImageSchema).max(10).default([]),
    topic: z.string().max(200).optional(),
    hook: z.string().max(500).optional(),
    score: z.number().min(0).max(10).optional(),
    title: z.string().max(200).optional(),
    accounts: z.array(z.string().regex(ACCOUNT_REF_PATTERN)).min(1).max(20).optional(),
  })
  .refine((clip) => clip.end > clip.start, { message: 'end must be greater than start' });

export const cutsSchema = z
  .strictObject({ clips: z.array(clipSchema).min(1).max(20) })
  .refine((cuts) => new Set(cuts.clips.map((clip) => clip.id)).size === cuts.clips.length, {
    message: 'clip ids must be unique',
  });

export type Focus = z.infer<typeof focusSchema>;
export type Crop = z.infer<typeof cropSchema>;
export type Pace = z.infer<typeof paceSchema>;
export type ClipImage = z.infer<typeof clipImageSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Cuts = z.infer<typeof cutsSchema>;
