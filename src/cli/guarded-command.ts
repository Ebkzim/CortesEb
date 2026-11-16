import { CommandRunner } from 'nest-commander';
import type { z } from 'zod';
import { AppError } from '../common/app-error.js';

export type RawOptions = Record<string, unknown>;

export abstract class GuardedCommand extends CommandRunner {
  protected abstract execute(params: string[], options: RawOptions): Promise<void>;

  async run(params: string[], options: RawOptions = {}): Promise<void> {
    try {
      await this.execute(params, options);
    } catch (error) {
      process.exitCode = 1;
      process.stderr.write(`erro: ${describe(error)}\n`);
    }
  }
}

export function parseOptions<Schema extends z.ZodType>(
  schema: Schema,
  options: RawOptions,
): z.infer<Schema> {
  const parsed = schema.safeParse(options);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = issue === undefined ? 'opções' : `--${issue.path.join('.')}: ${issue.message}`;
  throw new AppError('INVALID_INPUT', `opção inválida (${where})`);
}

function describe(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message.split(/\r?\n/)[0] ?? 'erro inesperado';
  return 'erro inesperado';
}
