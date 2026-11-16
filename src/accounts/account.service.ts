import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import {
  ACCOUNT_ID_PATTERN,
  MAX_ACCOUNTS,
  UserConfigStore,
  type UserConfig,
} from '../config/user-config.js';
import { ImageFetcher } from '../images/image-fetcher.js';

export interface AccountView {
  id: string;
  name: string;
  logo: string;
  isDefault: boolean;
}

export interface AccountInput {
  name?: string;
  logo?: string;
}

export const ALL_ACCOUNTS = 'all';

@Injectable()
export class AccountService {
  constructor(
    private readonly config: UserConfigStore,
    private readonly paths: AppPaths,
    private readonly images: ImageFetcher,
  ) {}

  async list(): Promise<AccountView[]> {
    return this.views(await this.config.load());
  }

  async save(id: string, input: AccountInput): Promise<AccountView> {
    assertId(id);
    const config = await this.config.load();
    const current = config.accounts[id];
    if (current === undefined && Object.keys(config.accounts).length >= MAX_ACCOUNTS) {
      throw new AppError('INVALID_INPUT', `limite de ${MAX_ACCOUNTS} contas atingido`);
    }
    const name = input.name ?? current?.name;
    if (name === undefined) throw new AppError('INVALID_INPUT', 'informe --name para a conta nova');
    let logo = current?.logo;
    if (input.logo !== undefined) {
      const stored = await this.images.importFile(input.logo, this.paths.home, `logo-${id}`);
      const fresh = path.basename(stored);
      if (logo !== undefined && logo !== fresh)
        await fs.rm(this.paths.inHome(logo), { force: true });
      logo = fresh;
    }
    if (logo === undefined) throw new AppError('INVALID_INPUT', 'informe --logo para a conta nova');
    const next = await this.config.replace({
      ...config,
      accounts: { ...config.accounts, [id]: { name, logo } },
      defaultAccount: config.defaultAccount ?? id,
    });
    return this.pick(next, id);
  }

  async remove(id: string): Promise<AccountView[]> {
    const config = await this.config.load();
    const target = config.accounts[id];
    if (target === undefined) throw unknownAccount(id, config);
    const accounts = Object.fromEntries(
      Object.entries(config.accounts).filter(([key]) => key !== id),
    );
    const { defaultAccount, ...rest } = config;
    const fallback = defaultAccount === id ? Object.keys(accounts)[0] : defaultAccount;
    const next = await this.config.replace({
      ...rest,
      accounts,
      ...(fallback === undefined ? {} : { defaultAccount: fallback }),
    });
    await fs.rm(this.paths.inHome(target.logo), { force: true });
    return this.views(next);
  }

  async setDefault(id: string): Promise<AccountView> {
    const config = await this.config.load();
    if (config.accounts[id] === undefined) throw unknownAccount(id, config);
    return this.pick(await this.config.update({ defaultAccount: id }), id);
  }

  async resolve(ids: readonly string[] | undefined): Promise<AccountView[]> {
    const config = await this.config.load();
    const all = this.views(config);
    if (all.length === 0) {
      throw new AppError('NOT_CONFIGURED', 'nenhuma conta cadastrada: rode cortes-eb account add');
    }
    if (ids === undefined) {
      const fallback = all.find((account) => account.isDefault) ?? all[0];
      return fallback === undefined ? [] : [fallback];
    }
    if (ids.includes(ALL_ACCOUNTS)) return all;
    return [...new Set(ids)].map((id) => {
      const account = all.find((item) => item.id === id);
      if (account === undefined) throw unknownAccount(id, config);
      return account;
    });
  }

  async logoFile(account: AccountView): Promise<string> {
    const file = this.paths.inHome(account.logo);
    if (!(await exists(file))) {
      throw new AppError('MISSING_FILE', `a logo da conta ${account.id} sumiu: cadastre de novo`);
    }
    return file;
  }

  private views(config: UserConfig): AccountView[] {
    return Object.entries(config.accounts).map(([id, account]) => ({
      id,
      name: account.name,
      logo: account.logo,
      isDefault: config.defaultAccount === id,
    }));
  }

  private pick(config: UserConfig, id: string): AccountView {
    const view = this.views(config).find((account) => account.id === id);
    if (view === undefined) throw unknownAccount(id, config);
    return view;
  }
}

function assertId(id: string): void {
  if (!ACCOUNT_ID_PATTERN.test(id) || id === ALL_ACCOUNTS) {
    throw new AppError('INVALID_INPUT', 'id da conta: minúsculas, números e hífen, até 32');
  }
}

function unknownAccount(id: string, config: UserConfig): AppError {
  const known = Object.keys(config.accounts).join(', ') || 'nenhuma';
  return new AppError('INVALID_INPUT', `conta desconhecida: ${id} (cadastradas: ${known})`);
}
