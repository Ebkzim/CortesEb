import { z } from 'zod';
import { BROWSER_PLATFORMS } from '../browser/browser-sessions.js';
import { ACCOUNT_ID_PATTERN } from '../config/user-config.js';

export const ACTIONS = ['views', 'likes', 'comments', 'commentLikes', 'replies'] as const;
export type Action = (typeof ACTIONS)[number];
const count = z.number().int().min(0).max(1000);
export const countsSchema = z.strictObject({
  views: count.default(10),
  likes: count.default(3),
  comments: count.default(0),
  commentLikes: count.default(0),
  replies: count.default(0),
});
export const warmingConfigSchema = z
  .strictObject({
    ai: z
      .object({
        source: z.enum(['configured', 'ollama', 'key']).default('ollama'),
        keyId: z.uuid().nullable().default(null),
        model: z.string().trim().min(1).max(100).default('qwen2.5:3b-instruct'),
      })
      .default({ source: 'ollama', keyId: null, model: 'qwen2.5:3b-instruct' }),
    verificationMode: z.enum(['browser', 'panel']).default('browser'),
    searchMode: z.enum(['economy', 'standard']).default('economy'),
    mode: z.enum(['goals', 'continuous']).default('goals'),
    goals: countsSchema.default(() => countsSchema.parse({})),
    watchSeconds: z.number().int().min(5).max(120).default(15),
    intervalSeconds: z.number().int().min(15).max(3600).default(60),
    guidance: z
      .string()
      .trim()
      .max(1000)
      .default('Escreva em português, de forma breve e natural.'),
  })
  .refine(
    (value) => ACTIONS.some((action) => value.goals[action] > 0),
    'defina pelo menos uma meta',
  );
export type WarmingConfig = z.infer<typeof warmingConfigSchema>;
export type Counts = z.infer<typeof countsSchema>;
export function emptyCounts(): Counts {
  return { views: 0, likes: 0, comments: 0, commentLikes: 0, replies: 0 };
}
export const activitySchema = z.object({
  at: z.string(),
  action: z.enum(ACTIONS).nullable(),
  message: z.string(),
  url: z.string().nullable(),
});
export const warmingSessionSchema = z.object({
  account: z.string().regex(ACCOUNT_ID_PATTERN),
  platform: z.enum(BROWSER_PLATFORMS),
  config: warmingConfigSchema,
  status: z.enum(['running', 'stopped', 'completed', 'attention']),
  counts: z.object(
    Object.fromEntries(ACTIONS.map((action) => [action, z.number().int().min(0)])) as Record<
      Action,
      z.ZodNumber
    >,
  ),
  day: z.string(),
  startedAt: z.string(),
  nextAt: z.string(),
  message: z.string().nullable(),
  progress: z
    .object({
      stage: z.string(),
      updatedAt: z.string(),
      videoUrl: z.string().nullable(),
      until: z.string().nullable(),
      frameAt: z.string().nullable(),
    })
    .optional(),
  seen: z.array(z.string()).default([]),
  history: z.array(activitySchema).default([]),
});
export type WarmingSession = z.infer<typeof warmingSessionSchema>;
export const warmingFileSchema = z.object({ sessions: z.array(warmingSessionSchema).default([]) });

export function goalsReached(
  session: Pick<WarmingSession, 'counts' | 'config' | 'platform'>,
): boolean {
  return ACTIONS.every(
    (action) =>
      (session.platform === 'tiktok' && action === 'commentLikes') ||
      session.counts[action] >= session.config.goals[action],
  );
}

export function dayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
