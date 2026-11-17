import { AppError } from '../common/app-error.js';

export interface LlmRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface LlmClient {
  readonly label: string;
  complete(request: LlmRequest): Promise<string>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const ERROR_LIMIT = 200;

export async function postJson(
  request: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError('REMOTE_FAILED', 'não consegui falar com o modelo (rede ou tempo esgotado)');
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => ''))
      .slice(0, ERROR_LIMIT)
      .replace(/\s+/g, ' ');
    throw new AppError('REMOTE_FAILED', `o modelo respondeu ${response.status}: ${detail}`);
  }
  try {
    return await response.json();
  } catch {
    throw new AppError('REMOTE_FAILED', 'resposta do modelo não é JSON');
  }
}

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last <= first) {
    throw new AppError('REMOTE_FAILED', 'o modelo não devolveu um JSON');
  }
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    throw new AppError('REMOTE_FAILED', 'o JSON do modelo está quebrado');
  }
}
