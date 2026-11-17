import { AppError } from '../common/app-error.js';
import { postJson, type FetchLike, type LlmClient, type LlmRequest } from './llm-client.js';

const TIMEOUT_MS = 5 * 60_000;
const TEMPERATURE = 0.2;

export class OpenAiCompatibleClient implements LlmClient {
  readonly label: string;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey: string | null,
    private readonly request: FetchLike = fetch,
  ) {
    this.label = `openai:${model}`;
  }

  async complete(request: LlmRequest): Promise<string> {
    const data = (await postJson(
      this.request,
      `${this.baseUrl}/chat/completions`,
      this.apiKey === null ? {} : { Authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        temperature: TEMPERATURE,
        max_tokens: request.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      },
      TIMEOUT_MS,
    )) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content === '') {
      throw new AppError('REMOTE_FAILED', 'o servidor devolveu uma resposta vazia');
    }
    return content;
  }
}
