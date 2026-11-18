import { z } from 'zod';
import { extractJson, type LlmClient } from '../llm/llm-client.js';

export interface Verdict {
  score: number;
  title: string;
}

const verdictSchema = z.object({
  why: z.string().optional(),
  standalone: z.boolean().optional(),
  payoff: z.boolean().optional(),
  score: z.coerce.number().min(0).max(10),
  title: z.string().trim().min(1).max(200),
});

const VERDICT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    why: { type: 'string' },
    standalone: { type: 'boolean' },
    payoff: { type: 'boolean' },
    score: { type: 'number' },
    title: { type: 'string' },
  },
  required: ['why', 'standalone', 'payoff', 'score', 'title'],
};

const MAX_TOKENS = 220;
const MAX_TEXT_CHARS = 6000;

export type JudgeFocus = 'clip' | 'live';

const FOCUS: Record<JudgeFocus, string[]> = {
  clip: [
    'You are a strict editor reviewing one candidate clip, to decide if it deserves to become a vertical short video.',
  ],
  live: [
    'You are an editor reviewing one moment cut from a live stream, to decide if it deserves to become a vertical short video.',
    'The moment was picked because the streamer or the chat reacted strongly. Shouting, laughter, surprise, rage, a fail, a win or a funny line are exactly what makes a good live clip, even without a clean beginning or end.',
  ],
};

const SCALE: Record<JudgeFocus, string> = {
  clip: '- score from 0 to 10: a strong opening, a concrete fact, a joke or a strong reaction, a complete thought score high. Greetings, filler, self promotion, ads, chatter and confusing talk score low. Be strict: most clips deserve 4 to 7.',
  live: '- score from 0 to 10: a strong reaction, a funny or shocking moment, a clutch play or a fail score 7 to 10. Ordinary talk scores 4 to 6. Only silence, greetings, ads or self promotion score below 4.',
};

export class ClipJudge {
  constructor(
    private readonly client: LlmClient,
    readonly minScore: number,
    private readonly niche: string,
    private readonly focus: JudgeFocus = 'clip',
  ) {}

  async judge(text: string): Promise<Verdict> {
    const request = {
      system: [
        ...FOCUS[this.focus],
        `Subject area: ${this.niche}.`,
        'Answer these questions about the clip:',
        '- why: in one short sentence, what would make a stranger watch it until the end (or why not).',
        '- standalone: true if a stranger understands it without anything said before it.',
        '- payoff: true if it ends on a conclusion, an answer, a punchline or a strong reaction, not in the middle of an idea.',
        SCALE[this.focus],
        '- title: a short catchy headline of at most 60 characters, written in the same language as the transcript (Brazilian Portuguese when the transcript is in Portuguese).',
        'Answer only with JSON with the keys why, standalone, payoff, score and title.',
      ].join('\n'),
      schema: VERDICT_JSON_SCHEMA,
      maxTokens: MAX_TOKENS,
    };
    const user = `Transcript of the clip:\n${text.slice(0, MAX_TEXT_CHARS)}`;
    try {
      return parse(await this.client.complete({ ...request, user }));
    } catch {
      return parse(
        await this.client.complete({
          ...request,
          user: `${user}\n\nYour previous answer was not valid. Answer again with only the JSON object.`,
        }),
      );
    }
  }
}

export function transcriptOf(
  words: readonly { text: string; startMs: number }[],
  from: number,
  to: number,
): string {
  return words
    .filter((word) => word.startMs / 1000 >= from && word.startMs / 1000 <= to)
    .map((word) => word.text)
    .join(' ');
}

function parse(text: string): Verdict {
  const verdict = verdictSchema.parse(extractJson(text));
  return { score: verdict.score, title: verdict.title };
}
