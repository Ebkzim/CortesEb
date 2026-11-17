import { Command, Option } from 'nest-commander';
import { z } from 'zod';
import { Output } from '../../common/output.js';
import { LLM_PROVIDERS, UserConfigStore } from '../../config/user-config.js';
import { llmBaseUrl } from '../../llm/llm-url.js';
import { NicheRegistry } from '../../niches/niche-registry.js';
import { SelectorService } from '../../select/selector.service.js';
import { Workspace } from '../../workspace/workspace.js';
import { GuardedCommand, parseOptions, type RawOptions } from '../guarded-command.js';

const selectOptions = z.object({
  work: z.string().min(1).max(1024),
  llm: z.enum(LLM_PROVIDERS).optional(),
  llmModel: z.string().trim().min(1).max(100).optional(),
  llmUrl: z.string().min(1).max(300).optional(),
  count: z.coerce.number().int().positive().optional(),
  minSeconds: z.coerce.number().positive().optional(),
  maxSeconds: z.coerce.number().positive().optional(),
  minScore: z.coerce.number().min(0).max(10).default(6),
  chunkSeconds: z.coerce.number().min(60).max(1800).optional(),
});

@Command({
  name: 'select',
  description: 'escolhe os cortes com um modelo de IA (Ollama, API) e grava o cuts.json',
})
export class SelectCommand extends GuardedCommand {
  constructor(
    private readonly selector: SelectorService,
    private readonly config: UserConfigStore,
    private readonly niches: NicheRegistry,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '-w, --work <pasta>', description: 'pasta de trabalho', required: true })
  parseWork(value: string): string {
    return value;
  }

  @Option({ flags: '--llm <provedor>', description: LLM_PROVIDERS.join(', ') })
  parseLlm(value: string): string {
    return value;
  }

  @Option({ flags: '--llm-model <modelo>', description: 'modelo do provedor' })
  parseLlmModel(value: string): string {
    return value;
  }

  @Option({ flags: '--llm-url <endereço>', description: 'endereço do servidor' })
  parseLlmUrl(value: string): string {
    return value;
  }

  @Option({ flags: '-c, --count <n>', description: 'quantidade de cortes' })
  parseCount(value: string): string {
    return value;
  }

  @Option({ flags: '--min-seconds <n>', description: 'duração mínima de cada corte' })
  parseMinSeconds(value: string): string {
    return value;
  }

  @Option({ flags: '--max-seconds <n>', description: 'duração máxima de cada corte' })
  parseMaxSeconds(value: string): string {
    return value;
  }

  @Option({ flags: '--min-score <nota>', description: 'nota mínima do gancho (padrão 6)' })
  parseMinScore(value: string): string {
    return value;
  }

  @Option({ flags: '--chunk-seconds <n>', description: 'tamanho de cada trecho lido (padrão 360)' })
  parseChunkSeconds(value: string): string {
    return value;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(selectOptions, raw);
    const niche = this.niches.get((await this.config.load()).niche);
    const result = await this.selector.run(new Workspace(options.work), {
      llm: {
        ...(options.llm === undefined ? {} : { provider: options.llm }),
        ...(options.llmModel === undefined ? {} : { model: options.llmModel }),
        ...(options.llmUrl === undefined ? {} : { baseUrl: llmBaseUrl(options.llmUrl) }),
      },
      targets: {
        ...(options.count === undefined ? {} : { count: options.count }),
        ...(options.minSeconds === undefined ? {} : { minSeconds: options.minSeconds }),
        ...(options.maxSeconds === undefined ? {} : { maxSeconds: options.maxSeconds }),
      },
      niche: `${niche.label}: ${niche.summary}`,
      minScore: options.minScore,
      chunk: options.chunkSeconds === undefined ? {} : { chunkSeconds: options.chunkSeconds },
    });
    this.output.json(result);
  }
}
