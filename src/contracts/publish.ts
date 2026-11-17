import { z } from 'zod';
import { ACCOUNT_REF_PATTERN } from './cuts.js';

export const PLATFORMS = ['youtube', 'instagram', 'tiktok'] as const;
export const JOB_STATUSES = [
  'pending',
  'approved',
  'publishing',
  'published',
  'failed',
  'rejected',
] as const;

export const JOB_ID_PATTERN = /^j-[a-f0-9]{12}$/;

export const jobSchema = z.strictObject({
  id: z.string().regex(JOB_ID_PATTERN),
  file: z.string().min(1).max(1024),
  account: z.string().regex(ACCOUNT_REF_PATTERN),
  platform: z.enum(PLATFORMS),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(2200).default(''),
  tags: z.array(z.string().trim().min(1).max(30)).max(15).default([]),
  status: z.enum(JOB_STATUSES),
  attempts: z.number().int().nonnegative().default(0),
  scheduledAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  publishedUrl: z.url().max(2048).optional(),
  error: z.string().max(500).optional(),
});

export const queueFileSchema = z.strictObject({
  jobs: z.array(jobSchema).max(5000).default([]),
});

export type Platform = (typeof PLATFORMS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type Job = z.infer<typeof jobSchema>;
export type QueueFile = z.infer<typeof queueFileSchema>;
