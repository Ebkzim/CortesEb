import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command, Option } from 'nest-commander';
import { z } from 'zod';
import { Output } from '../../common/output.js';
import { AppPaths } from '../../config/app-paths.js';
import { startServer } from '../../server/bootstrap.js';
import { GuardedCommand, parseOptions, type RawOptions } from '../guarded-command.js';

const uiOptions = z.object({
  port: z.coerce.number().int().min(1024).max(65535).default(4317),
  open: z.boolean().default(true),
});

@Command({ name: 'ui', description: 'abre o painel no navegador' })
export class UiCommand extends GuardedCommand {
  constructor(
    private readonly paths: AppPaths,
    private readonly output: Output,
  ) {
    super();
  }

  @Option({ flags: '-p, --port <porta>', description: 'porta local (padrão 4317)' })
  parsePort(value: string): string {
    return value;
  }

  @Option({ flags: '--no-open', description: 'não abre o navegador sozinho' })
  parseNoOpen(): boolean {
    return false;
  }

  protected async execute(_params: string[], raw: RawOptions): Promise<void> {
    const options = parseOptions(uiOptions, raw);
    const server = await startServer(options.port, path.join(this.paths.packageRoot, 'web', 'out'));
    const link = `${server.url}/#acesso=${server.token}`;
    this.output.info(`> painel em ${server.url}`);
    this.output.info(`> link de acesso desta sessão: ${link}`);
    if (options.open) openBrowser(link);
    await new Promise<void>((resolve) => {
      const stop = (): void => {
        resolve();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    this.output.info('> fechando o painel (Ctrl+C de novo fecha na hora)');
    const force = (): void => {
      process.exit(1);
    };
    process.once('SIGINT', force);
    process.once('SIGTERM', force);
    const timer = setTimeout(() => {
      this.output.info('> o fechamento demorou demais; encerrando agora');
      process.exit(1);
    }, CLOSE_TIMEOUT_MS);
    timer.unref();
    await server.close();
    clearTimeout(timer);
  }
}

const CLOSE_TIMEOUT_MS = 15_000;

function openBrowser(link: string): void {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  const child = spawn(opener, [link], { stdio: 'ignore', detached: true, shell: false });
  child.on('error', () => undefined);
  child.unref();
}
