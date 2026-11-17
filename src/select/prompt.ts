import { z } from 'zod';
import type { ClipTargets } from '../planning/clip-targets.js';
import type { TranscriptChunk } from './transcript-chunks.js';

export const candidateSchema = z.object({
  start: z.coerce.number().nonnegative(),
  end: z.coerce.number().nonnegative(),
  score: z.coerce.number().min(0).max(10),
  hook: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(200),
  topic: z.string().trim().max(200).optional(),
});

export const answerSchema = z.object({ clips: z.array(candidateSchema).max(10) });

export type Candidate = z.infer<typeof candidateSchema>;

export interface PromptContext {
  niche: string;
  perChunk: number;
  targets: Pick<ClipTargets, 'minSeconds' | 'maxSeconds'>;
  peaks: readonly number[];
}

export function answerJsonSchema(perChunk: number): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      clips: {
        type: 'array',
        maxItems: perChunk,
        items: {
          type: 'object',
          properties: {
            start: { type: 'number' },
            end: { type: 'number' },
            score: { type: 'number' },
            hook: { type: 'string' },
            title: { type: 'string' },
            topic: { type: 'string' },
          },
          required: ['start', 'end', 'score', 'hook', 'title'],
        },
      },
    },
    required: ['clips'],
  };
}

export function buildSystemPrompt(context: PromptContext): string {
  const { minSeconds, maxSeconds } = context.targets;
  return [
    'You pick the best moments of a video transcript to cut into vertical short videos (Shorts, Reels, TikTok).',
    `Subject area: ${context.niche}.`,
    'Each line of the transcript starts with its time in seconds, like [312] text.',
    '',
    'Rules:',
    `- Each clip lasts between ${minSeconds} and ${maxSeconds} seconds. start and end are seconds from the transcript timestamps.`,
    '- The clip must start on the sentence that works as a hook: it makes a viewer scrolling the feed want to keep watching.',
    '- The clip must end right after the sentence that closes the thought. Never cut in the middle of an idea.',
    '- Prefer concrete facts, numbers, names, surprise, disagreement or a strong verdict. Avoid greetings, filler and anything that needs earlier context.',
    '- Never invent words. Use only what is in the transcript.',
    '- Score each hook from 0 to 10. Give 9 or 10 only to excellent hooks. Below 6 means not worth cutting.',
    `- Return at most ${context.perChunk} clips, from different topics, without overlapping times. Return an empty list if nothing is good.`,
    '- Write hook, title and topic in the same language as the transcript. The hook is the opening sentence of the clip. The title is a short headline of at most 60 characters.',
    '',
    'Answer only with JSON in the form {"clips":[{"start":0,"end":0,"score":0,"hook":"","title":"","topic":""}]}.',
  ].join('\n');
}

export function buildUserPrompt(chunk: TranscriptChunk, context: PromptContext): string {
  const hints =
    context.peaks.length === 0
      ? ''
      : `Loud moments (possible reactions) at seconds: ${context.peaks.join(', ')}.\n\n`;
  return `${hints}Transcript from ${Math.floor(chunk.from)}s to ${Math.floor(chunk.to)}s:\n${chunk.text}`;
}
