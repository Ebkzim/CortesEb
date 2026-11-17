import { Command } from 'nest-commander';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { Output } from '../../common/output.js';
import { PLATFORMS } from '../../contracts/publish.js';
import { CredentialVault } from '../../publish/credential-vault.js';
import { GuardedCommand } from '../guarded-command.js';

const ACTIONS = ['set', 'list', 'remove'] as const;
const MAX_INPUT_BYTES = 16 * 1024;

@Command({
  name: 'credentials',
  arguments: '<acao> [plataforma] [conta]',
  description: 'cofre de credenciais de postagem: set (JSON pela entrada padrão), list ou remove',
})
export class CredentialsCommand extends GuardedCommand {
  constructor(
    private readonly vault: CredentialVault,
    private readonly output: Output,
  ) {
    super();
  }

  protected async execute(params: string[]): Promise<void> {
    const [action, platformName, account] = params;
    const parsed = z.enum(ACTIONS).safeParse(action);
    if (!parsed.success) {
      throw new AppError('INVALID_INPUT', `ação inválida: use ${ACTIONS.join(', ')}`);
    }
    if (parsed.data === 'list') {
      this.output.json(await this.vault.list());
      return;
    }
    const platform = z.enum(PLATFORMS).safeParse(platformName);
    if (!platform.success || account === undefined) {
      throw new AppError(
        'INVALID_INPUT',
        `informe a plataforma (${PLATFORMS.join(', ')}) e a conta`,
      );
    }
    if (parsed.data === 'remove') {
      this.output.json({ removed: await this.vault.remove(platform.data, account) });
      return;
    }
    this.output.json(await this.vault.save(platform.data, account, await readJsonInput()));
  }
}

async function readJsonInput(): Promise<unknown> {
  if (process.stdin.isTTY) {
    throw new AppError(
      'INVALID_INPUT',
      'envie o JSON pela entrada padrão, por exemplo: cat credenciais.json | cortes-eb credentials set ...',
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_INPUT_BYTES) throw new AppError('INVALID_INPUT', 'entrada grande demais');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_INPUT', 'a entrada não é um JSON válido');
  }
}
