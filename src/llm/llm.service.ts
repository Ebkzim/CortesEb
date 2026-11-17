import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { Secrets } from '../config/secrets.js';
import { UserConfigStore, type UserConfig } from '../config/user-config.js';
import { AnthropicClient } from './anthropic-client.js';
import type { FetchLike, LlmClient } from './llm-client.js';
import { llmBaseUrl } from './llm-url.js';
import { OllamaClient, ollamaModels } from './ollama-client.js';
import { OpenAiCompatibleClient } from './openai-client.js';

export type LlmSettings = UserConfig['llm'];

export interface LlmStatus {
  provider: LlmSettings['provider'];
  model: string | null;
  baseUrl: string | null;
  keyPresent: boolean | null;
  reachable: boolean | null;
  modelInstalled: boolean | null;
  installedModels: string[];
}

export const OLLAMA_URL = 'http://127.0.0.1:11434';
export const OPENAI_URL = 'https://api.openai.com/v1';
export const ANTHROPIC_MODEL = 'claude-sonnet-5-5';

@Injectable()
export class LlmService {
  constructor(
    private readonly config: UserConfigStore,
    private readonly secrets: Secrets,
  ) {}

  async settings(override: Partial<LlmSettings> = {}): Promise<LlmSettings> {
    const saved = (await this.config.load()).llm;
    return { ...saved, ...definedOnly(override) };
  }

  async client(override: Partial<LlmSettings> = {}, request?: FetchLike): Promise<LlmClient> {
    const settings = await this.settings(override);
    switch (settings.provider) {
      case 'agent':
        throw new AppError(
          'NOT_CONFIGURED',
          'o provedor está em agent: o agente da conversa escolhe os cortes. Use cortes-eb config --llm ollama para um modelo próprio',
        );
      case 'ollama':
        return new OllamaClient(
          llmBaseUrl(settings.baseUrl ?? OLLAMA_URL),
          this.requireModel(settings),
          request,
        );
      case 'openai':
        return new OpenAiCompatibleClient(
          llmBaseUrl(settings.baseUrl ?? OPENAI_URL),
          this.requireModel(settings),
          this.secrets.has('CORTES_EB_LLM_API_KEY')
            ? this.secrets.require('CORTES_EB_LLM_API_KEY')
            : null,
          request,
        );
      case 'anthropic':
        return new AnthropicClient(
          settings.model ?? ANTHROPIC_MODEL,
          this.secrets.require('ANTHROPIC_API_KEY'),
          request,
        );
    }
  }

  async status(override: Partial<LlmSettings> = {}, request?: FetchLike): Promise<LlmStatus> {
    const settings = await this.settings(override);
    const base: LlmStatus = {
      provider: settings.provider,
      model: settings.model ?? (settings.provider === 'anthropic' ? ANTHROPIC_MODEL : null),
      baseUrl: null,
      keyPresent: null,
      reachable: null,
      modelInstalled: null,
      installedModels: [],
    };
    if (settings.provider === 'ollama') {
      const baseUrl = llmBaseUrl(settings.baseUrl ?? OLLAMA_URL);
      try {
        const installed = await ollamaModels(baseUrl, request);
        return {
          ...base,
          baseUrl,
          reachable: true,
          installedModels: installed,
          modelInstalled: settings.model === undefined ? null : installed.includes(settings.model),
        };
      } catch {
        return { ...base, baseUrl, reachable: false };
      }
    }
    if (settings.provider === 'openai') {
      return {
        ...base,
        baseUrl: llmBaseUrl(settings.baseUrl ?? OPENAI_URL),
        keyPresent: this.secrets.has('CORTES_EB_LLM_API_KEY'),
      };
    }
    if (settings.provider === 'anthropic') {
      return { ...base, keyPresent: this.secrets.has('ANTHROPIC_API_KEY') };
    }
    return base;
  }

  private requireModel(settings: LlmSettings): string {
    if (settings.model === undefined) {
      throw new AppError('NOT_CONFIGURED', 'defina o modelo: cortes-eb config --llm-model <nome>');
    }
    return settings.model;
  }
}

function definedOnly(settings: Partial<LlmSettings>): Partial<LlmSettings> {
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
}
