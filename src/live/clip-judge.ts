import { z } from 'zod';
import { extractJson, type LlmClient } from '../llm/llm-client.js';

export interface Verdict {
  score: number;
  title: string;
}

const verdictSchema = z.object({
  score: z.coerce.number().min(0).max(10),
  title: z.string().trim().min(1).max(200),
});

const VERDICT_JSON_SCHEMA = {
  type: 'object',
  properties: { score: { type: 'number' }, title: { type: 'string' } },
  required: ['score', 'title'],
};

const MAX_TOKENS = 120;
const MAX_TEXT_CHARS = 6000;

export class ClipJudge {
  constructor(
    private readonly client: LlmClient,
    readonly minScore: number,
    private readonly niche: string,
  ) {}

  async judge(text: string): Promise<Verdict> {
    const request = {
      system: [
        'You review one candidate clip taken from a live stream, to decide if it deserves to become a vertical short video.',
        `Subject area: ${this.niche}.`,
        'Score the clip from 0 to 10: a strong opening sentence, a concrete fact or a strong reaction, a complete thought and no need for earlier context score high. Greetings, filler, self promotion, ads and chatter score low.',
        'Write a short headline of at most 60 characters in the same language as the transcript.',
        'Answer only with JSON like {"score":0,"title":""}.',
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
  return verdictSchema.parse(extractJson(text));
}
