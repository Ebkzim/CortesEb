import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { AccountService } from '../accounts/account.service.js';
import { BROWSER_PLATFORMS, BrowserSessions } from '../browser/browser-sessions.js';
import { readIdentity } from '../browser/identity.js';
import { LoginWindows, type LoginWindow } from '../browser/login-windows.js';
import { isLoggedIn, SITES } from '../browser/sites.js';
import { AppError } from '../common/app-error.js';
import { UserConfigStore, type PublishMethod } from '../config/user-config.js';
import { PLATFORMS, type Platform } from '../contracts/publish.js';
import { CredentialVault } from '../publish/credential-vault.js';
import { methodOf, methodsOf } from '../publish/publish-method.js';
import { QueueStore } from '../publish/queue-store.js';

export interface NetworkView {
  platform: Platform;
  method: PublishMethod;
  connected: boolean;
  handle: string | null;
  url: string | null;
  connectedAt: string | null;
}

export interface AccountNetworks {
  id: string;
  name: string | null;
  networks: NetworkView[];
}

export interface NetworksOverview {
  methods: Record<Platform, PublishMethod>;
  accounts: AccountNetworks[];
  logins: LoginWindow[];
}

const accountId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

@Controller('api/networks')
export class NetworksController {
  constructor(
    private readonly accounts: AccountService,
    private readonly sessions: BrowserSessions,
    private readonly vault: CredentialVault,
    private readonly config: UserConfigStore,
    private readonly logins: LoginWindows,
    private readonly store: QueueStore,
  ) {}

  @Get()
  async overview(): Promise<NetworksOverview> {
    const { publishing } = await this.config.load();
    const profiles = await this.sessions.profiles();
    const credentials = await this.vault.list();
    const accounts = (await this.accounts.list()).map((account) => ({
      id: account.id,
      name: account.name,
      networks: PLATFORMS.map((platform): NetworkView => {
        const method = methodOf(publishing, platform);
        if (method === 'api') {
          const saved = credentials.some(
            (entry) => entry.platform === platform && entry.account === account.id,
          );
          return {
            platform,
            method,
            connected: saved,
            handle: null,
            url: null,
            connectedAt: null,
          };
        }
        const profile = profiles.find(
          (item) => item.platform === platform && item.account === account.id,
        );
        return {
          platform,
          method,
          connected: profile?.connected === true,
          handle: profile?.handle ?? null,
          url: profile?.url ?? null,
          connectedAt: profile?.connectedAt ?? null,
        };
      }),
    }));
    return { methods: methodsOf(publishing), accounts, logins: this.logins.list() };
  }

  @Post(':account/:platform/check')
  async check(
    @Param('account') account: string,
    @Param('platform') platform: string,
  ): Promise<NetworksOverview> {
    const target = await this.target(account, platform);
    await this.idle(target.account, target.platform);
    const found = await this.sessions.with(
      target.platform,
      target.account,
      async (page, context) => {
        if (!(await isLoggedIn(SITES[target.platform], context))) return null;
        return { identity: await readIdentity(target.platform, page) };
      },
    );
    await this.sessions.markConnected(
      target.platform,
      target.account,
      found !== null,
      found?.identity,
    );
    return this.overview();
  }

  @Delete(':account/:platform')
  async disconnect(
    @Param('account') account: string,
    @Param('platform') platform: string,
  ): Promise<NetworksOverview> {
    const parsedAccount = accountId.safeParse(account);
    const parsedPlatform = z.enum(PLATFORMS).safeParse(platform);
    if (!parsedAccount.success || !parsedPlatform.success) {
      throw new AppError('INVALID_INPUT', 'conta ou rede inválida');
    }
    await this.known(parsedAccount.data);
    const { publishing } = await this.config.load();
    if (methodOf(publishing, parsedPlatform.data) === 'api') {
      await this.vault.remove(parsedPlatform.data, parsedAccount.data);
      return this.overview();
    }
    const target = await this.target(account, platform);
    await this.idle(target.account, target.platform);
    await this.sessions.forget(target.platform, target.account);
    return this.overview();
  }

  private async target(
    account: string,
    platform: string,
  ): Promise<{ account: string; platform: (typeof BROWSER_PLATFORMS)[number] }> {
    const parsedAccount = accountId.safeParse(account);
    const parsedPlatform = z.enum(BROWSER_PLATFORMS).safeParse(platform);
    if (!parsedAccount.success || !parsedPlatform.success) {
      throw new AppError('INVALID_INPUT', 'conta ou rede inválida');
    }
    await this.known(parsedAccount.data);
    return { account: parsedAccount.data, platform: parsedPlatform.data };
  }

  private async known(account: string): Promise<void> {
    const exists = (await this.accounts.list()).some((item) => item.id === account);
    if (!exists) throw new AppError('INVALID_INPUT', 'conta não cadastrada');
  }

  private async idle(account: string, platform: Platform): Promise<void> {
    const busy = (await this.store.list('publishing')).some(
      (job) => job.account === account && job.platform === platform,
    );
    if (busy) {
      throw new AppError(
        'INVALID_INPUT',
        `há um post saindo agora no ${SITES[platform].label} dessa conta; tente de novo em alguns minutos`,
      );
    }
  }
}
