import { AppError } from '../common/app-error.js';
import { postJson, type FetchLike, type LlmClient, type LlmRequest } from './llm-client.js';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const API_VERSION = '2023-06-01';
const TIMEOUT_MS = 5 * 60_000;
const TEMPERATURE = 0.2;

export class AnthropicClient implements LlmClient {
  readonly label: string;

  constructor(
    private readonly model: string,
    private readonly apiKey: string,
    private readonly request: FetchLike = fetch,
  ) {
    this.label = `anthropic:${model}`;
  }

  async complete(request: LlmRequest): Promise<string> {
    const data = (await postJson(
      this.request,
      ANTHROPIC_URL,
      { 'x-api-key': this.apiKey, 'anthropic-version': API_VERSION },
      {
        model: this.model,
        max_tokens: request.maxTokens,
        temperature: TEMPERATURE,
        system: `${request.system}\n\nResponda somente com um objeto JSON válido, sem texto antes ou depois.`,
        messages: [{ role: 'user', content: request.user }],
      },
      TIMEOUT_MS,
    )) as { content?: { type?: unknown; text?: unknown }[] };
    const block = data.content?.find((item) => item.type === 'text');
    if (typeof block?.text !== 'string' || block.text === '') {
      throw new AppError('REMOTE_FAILED', 'a API da Anthropic devolveu uma resposta vazia');
    }
    return block.text;
  }
}
