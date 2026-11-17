import { Injectable } from '@nestjs/common';
import type { JobSelector } from '../contracts/job.js';
import { ApiKeyRepository } from '../database/api-key.repository.js';
import type { LlmClient } from '../llm/llm-client.js';
import { LlmService } from '../llm/llm.service.js';

@Injectable()
export class SelectorClients {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly llm: LlmService,
  ) {}

  async forSelector(selector: JobSelector): Promise<LlmClient | null> {
    if (selector.kind === 'api') {
      const key = await this.keys.reveal(selector.keyId);
      return this.llm.fromSpec({
        provider: key.provider,
        model: selector.model ?? key.model,
        baseUrl: key.baseUrl,
        apiKey: key.secret,
      });
    }
    if (selector.kind === 'ollama') {
      return this.llm.fromSpec({
        provider: 'ollama',
        model: selector.model,
        baseUrl: selector.baseUrl ?? null,
        apiKey: null,
      });
    }
    return null;
  }
}
