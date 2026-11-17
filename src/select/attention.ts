import type { Word } from '../contracts/media.js';
import type { Candidate } from './prompt.js';

export interface AttentionOptions {
  from: number;
  minGap: number;
  reaction: number;
  minSeconds: number;
  maxSeconds: number;
  minReactionWords: number;
  limit: number;
}

export const ATTENTION_DEFAULTS: AttentionOptions = {
  from: 0,
  minGap: 8,
  reaction: 12,
  minSeconds: 20,
  maxSeconds: 60,
  minReactionWords: 4,
  limit: 6,
};

const ACTIVE_DB = -40;
const QUIET_FLOOR_DB = -60;
const LEAD_SECONDS = 1.5;
const HOOK_WORDS = 10;

export function attentionMoments(
  words: readonly Word[],
  levels: readonly number[],
  options: Partial<AttentionOptions> = {},
): Candidate[] {
  const config = { ...ATTENTION_DEFAULTS, ...options };
  const total = levels.length;
  if (total === 0) return [];
  const spoken = new Uint8Array(total);
  for (const word of words) {
    const from = Math.max(0, Math.floor(word.startMs / 1000));
    const to = Math.min(total - 1, Math.floor(word.endMs / 1000));
    for (let second = from; second <= to; second += 1) spoken[second] = 1;
  }
  const found: Candidate[] = [];
  let second = Math.max(0, Math.floor(config.from));
  while (second < total) {
    if (spoken[second] === 1) {
      second += 1;
      continue;
    }
    let end = second;
    while (end < total && spoken[end] === 0) end += 1;
    const length = end - second;
    if (length >= config.minGap && end < total) {
      const gap = levels.slice(second, end);
      const loudness = median(gap);
      if (loudness >= ACTIVE_DB) {
        const reaction = words.filter(
          (word) => word.startMs / 1000 >= end && word.startMs / 1000 < end + config.reaction,
        );
        if (reaction.length >= config.minReactionWords) {
          const start = Math.max(config.from, second - LEAD_SECONDS);
          const last = reaction[reaction.length - 1];
          const stop = Math.min(
            start + config.maxSeconds,
            Math.max(start + config.minSeconds, (last?.endMs ?? end * 1000) / 1000 + 0.5),
          );
          const text = reaction.map((word) => word.text);
          found.push({
            start,
            end: Math.min(total, stop),
            score: Math.min(
              9,
              6 + Math.min(1.5, (length - config.minGap) / 10) + (reaction.length >= 8 ? 1 : 0),
            ),
            hook: text.slice(0, HOOK_WORDS).join(' '),
            title: `A reação: ${text.slice(0, 5).join(' ')}`,
          });
        }
      }
    }
    second = Math.max(end, second + 1);
  }
  return found.sort((a, b) => b.score - a.score).slice(0, config.limit);
}

function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return QUIET_FLOOR_DB;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? QUIET_FLOOR_DB;
}
