import path from 'node:path';
import { Command } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { Output } from '../../common/output.js';
import { ProcessRunner } from '../../common/process-runner.js';
import { AppPaths } from '../../config/app-paths.js';
import { GuardedCommand } from '../guarded-command.js';

const ACTIONS = ['migrate', 'status'] as const;
const PRISMA_TIMEOUT_MS = 5 * 60_000;

@Command({
  name: 'db',
  arguments: '<acao>',
  description: 'banco de dados do painel: migrate (aplica as migrations) ou status',
})
export class DbCommand extends GuardedCommand {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly paths: AppPaths,
    private readonly output: Output,
  ) {
    super();
  }

  protected async execute(params: string[]): Promise<void> {
    const parsed = z.enum(ACTIONS).safeParse(params[0]);
    if (!parsed.success) {
      throw new AppError('INVALID_INPUT', `ação inválida: use ${ACTIONS.join(', ')}`);
    }
    if ((process.env.DATABASE_URL ?? '').trim() === '') {
      throw new AppError(
        'NOT_CONFIGURED',
        `defina DATABASE_URL em ${path.join(this.paths.home, '.env')}`,
      );
    }
    const cli = path.join(this.paths.packageRoot, 'node_modules', 'prisma', 'build', 'index.js');
    const result = await this.runner.run(
      process.execPath,
      [cli, 'migrate', parsed.data === 'migrate' ? 'deploy' : 'status'],
      { cwd: this.paths.packageRoot, timeoutMs: PRISMA_TIMEOUT_MS },
    );
    const text = `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/)
      .filter(
        (line) => line.trim() !== '' && !/postgres(ql)?:\/\//i.test(line) && !/[│┌└─]/.test(line),
      );
    this.output.json({ ok: result.code === 0, output: text.slice(-12) });
    if (result.code !== 0) process.exitCode = 1;
  }
}
