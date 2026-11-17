import { describe, expect, it } from 'vitest';
import type { Secrets } from '../config/secrets.js';
import type { UserConfigStore } from '../config/user-config.js';
import { userConfigSchema } from '../config/user-config.js';
import { AnthropicClient } from './anthropic-client.js';
import { extractJson, type FetchLike } from './llm-client.js';
import { llmBaseUrl } from './llm-url.js';
import { LlmService } from './llm.service.js';
import { OllamaClient, ollamaModels } from './ollama-client.js';
import { OpenAiCompatibleClient } from './openai-client.js';

interface Call {
  url: string;
  init: RequestInit;
}

function scripted(body: unknown, status = 200): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    },
  };
}

const request = {
  system: 'sistema',
  user: 'usuário',
  schema: { type: 'object' },
  maxTokens: 300,
};

describe('extractJson', () => {
  it('reads plain, fenced and noisy json', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Claro! {"a":3} espero ter ajudado')).toEqual({ a: 3 });
  });

  it('rejects text without json or with broken json', () => {
    expect(() => extractJson('sem json')).toThrow();
    expect(() => extractJson('{"a":')).toThrow();
  });
});

describe('llmBaseUrl', () => {
  it('accepts https anywhere and http only for local hosts', () => {
    expect(llmBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
    expect(llmBaseUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    expect(llmBaseUrl('http://localhost:11434')).toBe('http://localhost:11434');
    expect(llmBaseUrl('http://192.168.0.20:11434')).toBe('http://192.168.0.20:11434');
    expect(llmBaseUrl('http://desktop.local:11434')).toBe('http://desktop.local:11434');
  });

  it('refuses plain http to the internet, credentials and other schemes', () => {
    expect(() => llmBaseUrl('http://api.example.com')).toThrow();
    expect(() => llmBaseUrl('http://8.8.8.8:11434')).toThrow();
    expect(() => llmBaseUrl('https://user:pass@api.example.com')).toThrow();
    expect(() => llmBaseUrl('ftp://localhost')).toThrow();
    expect(() => llmBaseUrl('nada')).toThrow();
  });
});

describe('OllamaClient', () => {
  it('sends the schema as the format and returns the message', async () => {
    const script = scripted({ message: { content: '{"clips":[]}' } });
    const client = new OllamaClient('http://127.0.0.1:11434', 'qwen2.5:7b', script.fetch);
    expect(await client.complete(request)).toBe('{"clips":[]}');
    expect(script.calls[0]?.url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(script.calls[0]?.init.body as string) as {
      model: string;
      stream: boolean;
      format: unknown;
      options: { num_predict: number };
    };
    expect(body.model).toBe('qwen2.5:7b');
    expect(body.stream).toBe(false);
    expect(body.format).toEqual({ type: 'object' });
    expect(body.options.num_predict).toBe(300);
    expect(client.label).toBe('ollama:qwen2.5:7b');
  });

  it('fails clearly on errors and empty answers', async () => {
    const down = scripted({ error: 'boom' }, 500);
    await expect(
      new OllamaClient('http://127.0.0.1:11434', 'm', down.fetch).complete(request),
    ).rejects.toThrow(/500/);
    const empty = scripted({ message: { content: '' } });
    await expect(
      new OllamaClient('http://127.0.0.1:11434', 'm', empty.fetch).complete(request),
    ).rejects.toThrow(/vazia/);
  });

  it('lists installed models', async () => {
    const script = scripted({ models: [{ name: 'qwen2.5:3b' }, { name: 'llama3.2:3b' }, {}] });
    expect(await ollamaModels('http://127.0.0.1:11434', script.fetch)).toEqual([
      'qwen2.5:3b',
      'llama3.2:3b',
    ]);
  });
});

describe('OpenAiCompatibleClient', () => {
  it('uses the bearer key only when one is set', async () => {
    const withKey = scripted({ choices: [{ message: { content: '{"a":1}' } }] });
    await new OpenAiCompatibleClient('https://h/v1', 'm', 'chave-123', withKey.fetch).complete(
      request,
    );
    expect((withKey.calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer chave-123',
    );
    expect(withKey.calls[0]?.url).toBe('https://h/v1/chat/completions');

    const without = scripted({ choices: [{ message: { content: '{"a":1}' } }] });
    await new OpenAiCompatibleClient('http://127.0.0.1:1234/v1', 'm', null, without.fetch).complete(
      request,
    );
    expect(
      (without.calls[0]?.init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });
});

describe('AnthropicClient', () => {
  it('calls the messages api with the key header and reads the text block', async () => {
    const script = scripted({ content: [{ type: 'text', text: '{"a":1}' }] });
    const text = await new AnthropicClient(
      'claude-sonnet-5-5',
      'sk-ant-xyz',
      script.fetch,
    ).complete(request);
    expect(text).toBe('{"a":1}');
    expect(script.calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = script.calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-xyz');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('never puts the key in an error message', async () => {
    const script = scripted({ error: 'invalid' }, 401);
    const error = await new AnthropicClient('m', 'sk-ant-secret', script.fetch)
      .complete(request)
      .catch((caught: unknown) => caught as Error);
    expect((error as Error).message).not.toContain('sk-ant-secret');
  });
});

describe('LlmService', () => {
  function service(llm: object, env: Record<string, string> = {}): LlmService {
    const config = {
      load: () => Promise.resolve(userConfigSchema.parse({ llm })),
    } as unknown as UserConfigStore;
    const secrets = {
      has: (name: string) => name in env,
      require: (name: string) => {
        const value = env[name];
        if (value === undefined) throw new Error('falta chave');
        return value;
      },
    } as unknown as Secrets;
    return new LlmService(config, secrets);
  }

  it('refuses to build a client in agent mode', async () => {
    await expect(service({ provider: 'agent' }).client()).rejects.toThrow(/agent/);
  });

  it('needs a model for ollama and uses the local default address', async () => {
    await expect(service({ provider: 'ollama' }).client()).rejects.toThrow(/modelo/);
    const client = await service({ provider: 'ollama', model: 'qwen2.5:3b' }).client();
    expect(client.label).toBe('ollama:qwen2.5:3b');
  });

  it('lets a request override the saved settings', async () => {
    const client = await service({ provider: 'agent' }).client({
      provider: 'ollama',
      model: 'x',
    });
    expect(client.label).toBe('ollama:x');
  });

  it('requires the anthropic key from the environment', async () => {
    await expect(service({ provider: 'anthropic' }).client()).rejects.toThrow();
    const client = await service({ provider: 'anthropic' }, { ANTHROPIC_API_KEY: 'k' }).client();
    expect(client.label).toBe('anthropic:claude-sonnet-5-5');
  });

  it('reports ollama reachability and whether the model is installed', async () => {
    const script = scripted({ models: [{ name: 'qwen2.5:3b' }] });
    const status = await service({ provider: 'ollama', model: 'qwen2.5:3b' }).status(
      {},
      script.fetch,
    );
    expect(status).toMatchObject({ reachable: true, modelInstalled: true });
    const missing = await service({ provider: 'ollama', model: 'outro' }).status({}, script.fetch);
    expect(missing.modelInstalled).toBe(false);
    const down = await service({ provider: 'ollama', model: 'x' }).status({}, () =>
      Promise.reject(new Error('off')),
    );
    expect(down.reachable).toBe(false);
  });

  it('reports key presence without revealing it', async () => {
    const status = await service(
      { provider: 'anthropic' },
      { ANTHROPIC_API_KEY: 'segredo' },
    ).status();
    expect(status.keyPresent).toBe(true);
    expect(JSON.stringify(status)).not.toContain('segredo');
  });
});
