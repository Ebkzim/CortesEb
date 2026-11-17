import { Command, Option } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { Output } from '../../common/output.js';
import { LLM_PROVIDERS } from '../../config/user-config.js';
import { llmBaseUrl } from '../../llm/llm-url.js';
import { LlmService } from '../../llm/llm.service.js';
import { GuardedCommand, parseOptions, type RawOptions } from '../guarded-command.js';

const ACTIONS = ['status', 'test'] as const;

const llmOptions = z.object({
  llm: z.enum(LLM_PROVIDERS).optional(),
  llmModel: z.string().trim().min(1).max(100).optional(),
  llmUrl: z.string().min(1).max(300).optional(),
});

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
};

@Command({
  name: 'llm',
  arguments: '<acao>',
  description: 'mostra ou testa o modelo que escolhe os cortes: status ou test',
})
export class LlmCommand extends GuardedCommand {
  constructor(
    private readonly llm: LlmService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '--llm <provedor>', description: LLM_PROVIDERS.join(', ') })
  parseProvider(value: string): string {
    return value;
  }

  @Option({ flags: '--llm-model <modelo>', description: 'nome do modelo' })
  parseModel(value: string): string {
    return value;
  }

  @Option({ flags: '--llm-url <endereço>', description: 'endereço do servidor' })
  parseUrl(value: string): string {
    return value;
  }

  protected async execute(params: string[], raw: RawOptions): Promise<void> {
    const parsed = z.enum(ACTIONS).safeParse(params[0]);
    if (!parsed.success) {
      throw new AppError('INVALID_INPUT', `ação inválida: use ${ACTIONS.join(', ')}`);
    }
    const options = parseOptions(llmOptions, raw);
    const override = {
      ...(options.llm === undefined ? {} : { provider: options.llm }),
      ...(options.llmModel === undefined ? {} : { model: options.llmModel }),
      ...(options.llmUrl === undefined ? {} : { baseUrl: llmBaseUrl(options.llmUrl) }),
    };
    if (parsed.data === 'status') {
      this.output.json(await this.llm.status(override));
      return;
    }
    const client = await this.llm.client(override);
    const started = Date.now();
    const answer = await client.complete({
      system: 'Responda com JSON.',
      user: 'Responda {"ok": true}',
      schema: SCHEMA,
      maxTokens: 20,
    });
    this.output.json({
      model: client.label,
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      answer: answer.slice(0, 200),
    });
  }
}
