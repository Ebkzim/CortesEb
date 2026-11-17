import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import { credentialFileSchema, credentialSchemas } from '../contracts/credentials.js';
import { PLATFORMS, type Platform } from '../contracts/publish.js';
import { ACCOUNT_ID_PATTERN } from '../config/user-config.js';

export interface CredentialSummary {
  platform: Platform;
  account: string;
  fields: string[];
}

const VAULT_MODE = 0o600;

@Injectable()
export class CredentialVault {
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly paths: AppPaths) {}

  async save(platform: Platform, account: string, data: unknown): Promise<CredentialSummary> {
    const key = entryKey(platform, account);
    const parsed = credentialSchemas[platform].safeParse(data);
    if (!parsed.success) {
      const expected = Object.keys(credentialSchemas[platform].shape).join(', ');
      throw new AppError(
        'INVALID_INPUT',
        `credenciais inválidas para ${platform} (use ${expected})`,
      );
    }
    const values = parsed.data as Record<string, string>;
    await this.update((entries) => ({ ...entries, [key]: values }));
    return { platform, account, fields: Object.keys(values) };
  }

  async load(platform: Platform, account: string): Promise<Record<string, string>> {
    const entry = (await this.read())[entryKey(platform, account)];
    if (entry === undefined) {
      throw new AppError(
        'NOT_CONFIGURED',
        `sem credenciais de ${platform} para a conta ${account} (cortes-eb credentials set)`,
      );
    }
    return entry;
  }

  async list(): Promise<CredentialSummary[]> {
    const entries = await this.read();
    return Object.entries(entries).flatMap(([key, values]) => {
      const [platform, account] = key.split(':');
      const known = PLATFORMS.find((item) => item === platform);
      if (known === undefined || account === undefined) return [];
      return [{ platform: known, account, fields: Object.keys(values) }];
    });
  }

  async remove(platform: Platform, account: string): Promise<boolean> {
    const key = entryKey(platform, account);
    let removed = false;
    await this.update((entries) => {
      removed = key in entries;
      return Object.fromEntries(Object.entries(entries).filter(([name]) => name !== key));
    });
    return removed;
  }

  private update(
    change: (
      entries: Record<string, Record<string, string>>,
    ) => Record<string, Record<string, string>>,
  ): Promise<void> {
    const run = this.lock.then(async () => {
      const entries = change(await this.read());
      await writeJson(this.paths.credentialsFile, { entries }, VAULT_MODE);
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<Record<string, Record<string, string>>> {
    if (!(await exists(this.paths.credentialsFile))) return {};
    return (await readJson(this.paths.credentialsFile, credentialFileSchema)).entries;
  }
}

function entryKey(platform: Platform, account: string): string {
  if (!ACCOUNT_ID_PATTERN.test(account)) {
    throw new AppError('INVALID_INPUT', 'id de conta inválido');
  }
  return `${platform}:${account}`;
}
