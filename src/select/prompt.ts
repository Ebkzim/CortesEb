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

export const pickSchema = z.object({
  topic: z.string().trim().max(200).optional(),
  first_line: z.coerce.number().int().positive(),
  last_line: z.coerce.number().int().positive(),
  why: z.string().trim().max(400).optional(),
  score: z.coerce.number().min(0).max(10),
  title: z.string().trim().min(1).max(200),
});

export const answerSchema = z.object({ clips: z.array(pickSchema).max(10) });

export type Candidate = z.infer<typeof candidateSchema>;

export interface PromptContext {
  niche: string;
  perChunk: number;
  targets: Pick<ClipTargets, 'minSeconds' | 'maxSeconds'>;
  peaks: readonly number[];
  guidance?: string;
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
            topic: { type: 'string' },
            first_line: { type: 'integer' },
            last_line: { type: 'integer' },
            why: { type: 'string' },
            score: { type: 'number' },
            title: { type: 'string' },
          },
          required: ['topic', 'first_line', 'last_line', 'why', 'score', 'title'],
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
    'Each transcript line looks like: L12 [312] text. L12 is the line number and [312] is the time in seconds.',
    '',
    'How to work:',
    '1. Read the whole transcript and find the moments a stranger scrolling the feed would stop to watch.',
    '2. For each moment, choose the first line (the hook) and the last line (where the thought or the joke closes).',
    '3. Check that the moment makes sense alone, without anything said before it. If it needs context, skip it.',
    '',
    'Rules:',
    `- Each clip lasts between ${minSeconds} and ${maxSeconds} seconds: compare the [seconds] of the first and the last line.`,
    '- The first line must grab attention on its own: a strong claim, a question, a surprise, a joke, a fact or a reaction.',
    '- The last line closes the idea: the answer, the punchline, the verdict. Never stop in the middle of an idea.',
    '- Skip greetings, intros, asking for likes or subscriptions, ads, sponsors, small talk, technical problems and filler.',
    '- Each clip is about a different topic. Clips never overlap.',
    '- why: one short sentence saying why a stranger would watch until the end.',
    '- score from 0 to 10. 9 or 10 only for excellent moments. Below 6 means not worth cutting. Be strict.',
    `- Return at most ${context.perChunk} clips. Return an empty list if nothing is good: that is better than a weak clip.`,
    '- Write title, topic and why in the same language as the transcript. The title is a short catchy headline of at most 60 characters.',
    '',
    ...(context.guidance === undefined || context.guidance === ''
      ? []
      : [
          'Context about this video and what makes a good clip (in Portuguese):',
          context.guidance,
          '',
        ]),
    'Answer only with JSON in the form {"clips":[{"topic":"","first_line":0,"last_line":0,"why":"","score":0,"title":""}]}.',
  ].join('\n');
}

export function buildUserPrompt(chunk: TranscriptChunk, context: PromptContext): string {
  const hints =
    context.peaks.length === 0
      ? ''
      : `Loud moments (possible reactions) at seconds: ${context.peaks.join(', ')}.\n\n`;
  return `${hints}Transcript from ${Math.floor(chunk.from)}s to ${Math.floor(chunk.to)}s:\n${chunk.text}`;
}
