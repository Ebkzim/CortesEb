import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import {
  credentialEntriesSchema,
  credentialFileSchema,
  credentialSchemas,
  type CredentialEntries,
} from '../contracts/credentials.js';
import { loadMasterKey, SecretBox } from '../database/secret-box.js';
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
  private box: SecretBox | null = null;

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
    const entry = (await this.entries())[entryKey(platform, account)];
    if (entry === undefined) {
      throw new AppError(
        'NOT_CONFIGURED',
        `sem credenciais de ${platform} para a conta ${account} (cortes-eb credentials set)`,
      );
    }
    return entry;
  }

  async list(): Promise<CredentialSummary[]> {
    const entries = await this.entries();
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

  private update(change: (entries: CredentialEntries) => CredentialEntries): Promise<void> {
    const run = this.lock.then(async () => {
      const entries = change((await this.read()).entries);
      const box = await this.secretBox();
      await writeJson(
        this.paths.credentialsFile,
        { version: 1, sealed: box.seal(JSON.stringify(entries)) },
        VAULT_MODE,
      );
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async entries(): Promise<CredentialEntries> {
    const current = await this.read();
    if (!current.legacy) return current.entries;
    await this.update((entries) => entries);
    return (await this.read()).entries;
  }

  private async read(): Promise<{ entries: CredentialEntries; legacy: boolean }> {
    if (!(await exists(this.paths.credentialsFile))) return { entries: {}, legacy: false };
    const file = await readJson(this.paths.credentialsFile, credentialFileSchema);
    if ('entries' in file) return { entries: file.entries, legacy: true };
    const box = await this.secretBox();
    let data: unknown;
    try {
      data = JSON.parse(box.open(file.sealed));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('INVALID_INPUT', 'cofre de credenciais ilegível');
    }
    const parsed = credentialEntriesSchema.safeParse(data);
    if (!parsed.success) throw new AppError('INVALID_INPUT', 'cofre de credenciais ilegível');
    return { entries: parsed.data, legacy: false };
  }

  private async secretBox(): Promise<SecretBox> {
    this.box ??= new SecretBox(
      await loadMasterKey(this.paths.home, process.env.CORTES_EB_MASTER_KEY),
    );
    return this.box;
  }
}

function entryKey(platform: Platform, account: string): string {
  if (!ACCOUNT_ID_PATTERN.test(account)) {
    throw new AppError('INVALID_INPUT', 'id de conta inválido');
  }
  return `${platform}:${account}`;
}
