import { Command, Option } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { Output } from '../../common/output.js';
import { PublishService } from '../../publish/publish-service.js';
import { GuardedCommand, parseOptions, type RawOptions } from '../guarded-command.js';

const ACTIONS = ['install', 'uninstall', 'status'] as const;

const serviceOptions = z.object({
  maxPerDay: z.coerce.number().int().min(1).max(50).default(3),
  minGap: z.coerce.number().min(0).max(1440).default(30),
});

@Command({
  name: 'service',
  arguments: '<acao>',
  description: 'postagem automática ao ligar o computador: install, uninstall ou status',
})
export class ServiceCommand extends GuardedCommand {
  constructor(
    private readonly service: PublishService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '--max-per-day <n>', description: 'posts por dia por conta e rede (3)' })
  parseMaxPerDay(value: string): string {
    return value;
  }

  @Option({ flags: '--min-gap <minutos>', description: 'intervalo entre posts (30)' })
  parseMinGap(value: string): string {
    return value;
  }

  protected async execute(params: string[], raw: RawOptions): Promise<void> {
    const parsed = z.enum(ACTIONS).safeParse(params[0]);
    if (!parsed.success) {
      throw new AppError('INVALID_INPUT', `ação inválida: use ${ACTIONS.join(', ')}`);
    }
    const options = parseOptions(serviceOptions, raw);
    switch (parsed.data) {
      case 'install':
        this.output.json(
          await this.service.install({
            maxPerDay: options.maxPerDay,
            minGapMs: options.minGap * 60_000,
          }),
        );
        return;
      case 'uninstall':
        this.output.json(await this.service.uninstall());
        return;
      case 'status':
        this.output.json(await this.service.status());
    }
  }
}
