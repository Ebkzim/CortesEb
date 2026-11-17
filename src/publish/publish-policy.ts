import type { Job } from '../contracts/publish.js';

export interface PolicyLimits {
  maxPerDay: number;
  minGapMs: number;
}

export const POLICY_DEFAULTS: PolicyLimits = {
  maxPerDay: 3,
  minGapMs: 30 * 60 * 1000,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export type PolicyDecision = { ok: true } | { ok: false; retryAt: Date; reason: string };

export function evaluatePolicy(
  job: Job,
  published: readonly Job[],
  now: Date,
  limits: PolicyLimits = POLICY_DEFAULTS,
): PolicyDecision {
  const times = published
    .filter((item) => item.account === job.account && item.platform === job.platform)
    .map((item) => new Date(item.updatedAt).getTime())
    .sort((a, b) => a - b);
  const current = now.getTime();
  const recent = times.filter((time) => time > current - DAY_MS);
  let retryAt = 0;
  let reason = '';
  if (recent.length >= limits.maxPerDay) {
    const blocker = recent[recent.length - limits.maxPerDay];
    if (blocker !== undefined) {
      retryAt = blocker + DAY_MS;
      reason = `limite de ${limits.maxPerDay} posts por dia`;
    }
  }
  const last = times[times.length - 1];
  if (last !== undefined && last + limits.minGapMs > current && last + limits.minGapMs > retryAt) {
    retryAt = last + limits.minGapMs;
    reason = `intervalo mínimo de ${Math.round(limits.minGapMs / 60000)} min entre posts`;
  }
  return retryAt > current ? { ok: false, retryAt: new Date(retryAt), reason } : { ok: true };
}
