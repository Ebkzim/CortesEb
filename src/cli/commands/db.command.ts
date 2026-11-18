import { Command } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { Output } from '../../common/output.js';
import { PrismaService } from '../../database/prisma.service.js';
import { GuardedCommand } from '../guarded-command.js';

const ACTIONS = ['migrate', 'status'] as const;

@Command({
  name: 'db',
  arguments: '<acao>',
  description: 'banco de dados do painel: migrate (aplica as migrations) ou status',
})
export class DbCommand extends GuardedCommand {
  constructor(
    private readonly prisma: PrismaService,
    private readonly output: Output,
  ) {
    super();
  }

  protected execute(params: string[]): Promise<void> {
    const parsed = z.enum(ACTIONS).safeParse(params[0]);
    if (!parsed.success) {
      throw new AppError('INVALID_INPUT', `ação inválida: use ${ACTIONS.join(', ')}`);
    }
    const report = parsed.data === 'migrate' ? this.prisma.migrate() : this.prisma.status();
    this.output.json({ ok: true, file: this.prisma.file, ...report });
    return Promise.resolve();
  }
}
