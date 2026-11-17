import { Command, Option } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { Output } from '../../common/output.js';
import { JOB_STATUSES, PLATFORMS } from '../../contracts/publish.js';
import { QueueService } from '../../publish/queue.service.js';
import { GuardedCommand, parseOptions, type RawOptions } from '../guarded-command.js';

const ACTIONS = ['add', 'list', 'status', 'approve', 'reject', 'retry'] as const;

const queueOptions = z.object({
  account: z.string().min(1).max(700).optional(),
  platform: z.string().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(2200).optional(),
  tags: z.string().max(500).optional(),
  at: z.iso.datetime({ offset: true }).optional(),
  state: z.enum(JOB_STATUSES).optional(),
});

@Command({
  name: 'queue',
  arguments: '<acao> [itens...]',
  description: 'fila de postagem: add, list, status, approve, reject ou retry',
})
export class QueueCommand extends GuardedCommand {
  constructor(
    private readonly queue: QueueService,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '-a, --account <ids>', description: 'contas separadas por vírgula, ou all' })
  parseAccount(value: string): string {
    return value;
  }

  @Option({ flags: '-p, --platform <lista>', description: 'youtube, instagram, tiktok (vírgula)' })
  parsePlatform(value: string): string {
    return value;
  }

  @Option({ flags: '-t, --title <texto>', description: 'título do vídeo' })
  parseTitle(value: string): string {
    return value;
  }

  @Option({ flags: '-d, --description <texto>', description: 'descrição do vídeo' })
  parseDescription(value: string): string {
    return value;
  }

  @Option({ flags: '--tags <lista>', description: 'hashtags separadas por vírgula' })
  parseTags(value: string): string {
    return value;
  }

  @Option({ flags: '--at <data>', description: 'agenda para esta data ISO 8601' })
  parseAt(value: string): string {
    return value;
  }

  @Option({ flags: '--state <estado>', description: 'filtra o list por estado' })
  parseState(value: string): string {
    return value;
  }

  protected async execute(params: string[], raw: RawOptions): Promise<void> {
    const [action, ...items] = params;
    const parsed = z.enum(ACTIONS).safeParse(action);
    if (!parsed.success) {
      throw new AppError('INVALID_INPUT', `ação inválida: use ${ACTIONS.join(', ')}`);
    }
    const options = parseOptions(queueOptions, raw);
    switch (parsed.data) {
      case 'status':
        this.output.json(await this.queue.summary());
        return;
      case 'list':
        this.output.json(await this.queue.list(options.state));
        return;
      case 'add':
        this.output.json(
          await this.queue.enqueue({
            files: required(items, 'informe os vídeos .mp4'),
            accounts: options.account?.split(','),
            platforms: platformsOf(options.platform),
            title: options.title,
            description: options.description,
            tags:
              options.tags
                ?.split(',')
                .map((tag) => tag.trim())
                .filter(Boolean) ?? [],
            scheduledAt: options.at,
          }),
        );
        return;
      case 'approve':
        this.output.json(await this.queue.approve(required(items, 'informe os ids ou all')));
        return;
      case 'reject':
        this.output.json(await this.queue.reject(required(items, 'informe os ids ou all')));
        return;
      case 'retry':
        this.output.json(await this.queue.retry(required(items, 'informe os ids ou all')));
    }
  }
}

function required(items: string[], message: string): string[] {
  if (items.length === 0) throw new AppError('INVALID_INPUT', message);
  return items;
}

function platformsOf(value: string | undefined): (typeof PLATFORMS)[number][] | undefined {
  if (value === undefined) return undefined;
  const list = z
    .array(z.enum(PLATFORMS))
    .min(1)
    .safeParse(value.split(',').map((item) => item.trim()));
  if (!list.success) {
    throw new AppError('INVALID_INPUT', `plataforma inválida: use ${PLATFORMS.join(', ')}`);
  }
  return list.data;
}
