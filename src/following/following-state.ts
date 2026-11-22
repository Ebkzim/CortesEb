import { z } from 'zod';
import { ACCOUNT_ID_PATTERN } from '../config/user-config.js';
import { secondsRange } from '../warming/timing.js';

export const followingConfigSchema = z.strictObject({
  mode: z.enum(['follow', 'unfollow']).default('follow'),
  goal: z.number().int().min(1).max(1000).default(10),
  interval: secondsRange(10, 3600).default({ minSeconds: 30, maxSeconds: 90 }),
  verificationMode: z.enum(['browser', 'panel']).default('browser'),
  searchMode: z.enum(['economy', 'standard']).default('economy'),
});
export type FollowingConfig = z.infer<typeof followingConfigSchema>;
export const relationshipEntrySchema = z.object({
  username: z.string().regex(/^[a-z0-9._]{1,30}$/i),
  mode: z.enum(['follow', 'unfollow']),
  state: z.enum(['pending', 'following', 'requested', 'unfollowed']),
  at: z.string(),
  checkedAt: z.string().nullable(),
});
export const followingSessionSchema = z.object({
  account: z.string().regex(ACCOUNT_ID_PATTERN),
  platform: z.literal('instagram'),
  config: followingConfigSchema,
  status: z.enum(['running', 'stopped', 'completed', 'attention']),
  counts: z.object({
    follow: z.number().int().min(0),
    requested: z.number().int().min(0),
    unfollow: z.number().int().min(0),
  }),
  nextAt: z.string(),
  startedAt: z.string(),
  message: z.string(),
  progress: z.object({
    stage: z.string(),
    username: z.string().nullable(),
    until: z.string().nullable(),
  }),
  lastIntervalSeconds: z.number().int().nullable(),
  candidates: z.array(z.string()),
  checked: z.array(z.string()),
  reels: z.array(z.string()),
  ledger: z.array(relationshipEntrySchema),
  history: z.array(
    z.object({ at: z.string(), username: z.string().nullable(), message: z.string() }),
  ),
});
export type FollowingSession = z.infer<typeof followingSessionSchema>;
export type RelationshipEntry = z.infer<typeof relationshipEntrySchema>;
export const followingFileSchema = z.object({
  sessions: z.array(followingSessionSchema).default([]),
});
export function achieved(session: FollowingSession): number {
  return session.config.mode === 'follow'
    ? session.counts.follow + session.counts.requested
    : session.counts.unfollow;
}
