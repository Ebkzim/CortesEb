import { AppError } from '../common/app-error.js';
import { postJson, type FetchLike, type LlmClient, type LlmRequest } from './llm-client.js';

const TIMEOUT_MS = 15 * 60_000;
const TAGS_TIMEOUT_MS = 5_000;
const CONTEXT_TOKENS = 8192;
const TEMPERATURE = 0.2;

export class OllamaClient implements LlmClient {
  readonly label: string;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly request: FetchLike = fetch,
  ) {
    this.label = `ollama:${model}`;
  }

  async complete(request: LlmRequest): Promise<string> {
    const data = (await postJson(
      this.request,
      `${this.baseUrl}/api/chat`,
      {},
      {
        model: this.model,
        stream: false,
        format: request.schema,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        options: {
          temperature: TEMPERATURE,
          num_ctx: CONTEXT_TOKENS,
          num_predict: request.maxTokens,
        },
      },
      TIMEOUT_MS,
    )) as { message?: { content?: unknown } };
    const content = data.message?.content;
    if (typeof content !== 'string' || content === '') {
      throw new AppError('REMOTE_FAILED', 'o Ollama devolveu uma resposta vazia');
    }
    return content;
  }
}

export async function ollamaModels(baseUrl: string, request: FetchLike = fetch): Promise<string[]> {
  let response: Response;
  try {
    response = await request(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('REMOTE_FAILED', `não consegui falar com o Ollama em ${baseUrl}`);
  }
  if (!response.ok) throw new AppError('REMOTE_FAILED', `o Ollama respondeu ${response.status}`);
  const data = (await response.json().catch(() => ({}))) as { models?: { name?: unknown }[] };
  return (data.models ?? []).flatMap((item) => (typeof item.name === 'string' ? [item.name] : []));
}
