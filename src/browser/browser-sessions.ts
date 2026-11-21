import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { AppError } from '../common/app-error.js';
import { resolveInside } from '../common/safe-path.js';
import { AppPaths } from '../config/app-paths.js';
import { ACCOUNT_REF_PATTERN } from '../contracts/cuts.js';

export const BROWSER_PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const;
export type BrowserPlatform = (typeof BROWSER_PLATFORMS)[number];

export const VIEWPORT = { width: 1280, height: 800 };

const CONNECTED_MARK = '.cortes-eb-connected';
const VISIBLE_ENV = 'CORTES_EB_BROWSER_VISIBLE';
const CHROME_ENV = 'CORTES_EB_CHROME';

export interface BrowserProfile {
  platform: BrowserPlatform;
  account: string;
  connected: boolean;
}

@Injectable()
export class BrowserSessions {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly paths: AppPaths) {}

  profileDir(platform: BrowserPlatform, account: string): string {
    if (!ACCOUNT_REF_PATTERN.test(account)) throw new AppError('INVALID_INPUT', 'conta inválida');
    return resolveInside(path.join(this.paths.home, 'browser'), `${platform}-${account}`);
  }

  async with<T>(
    platform: BrowserPlatform,
    account: string,
    work: (page: Page, context: BrowserContext) => Promise<T>,
  ): Promise<T> {
    const dir = this.profileDir(platform, account);
    const previous = this.locks.get(dir) ?? Promise.resolve();
    const run = previous.then(async () => {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const context = await this.launch(dir);
      try {
        const page = context.pages()[0] ?? (await context.newPage());
        return await work(page, context);
      } finally {
        await context.close().catch(() => undefined);
      }
    });
    this.locks.set(
      dir,
      run.catch(() => undefined),
    );
    return run;
  }

  async markConnected(
    platform: BrowserPlatform,
    account: string,
    connected: boolean,
  ): Promise<void> {
    const mark = path.join(this.profileDir(platform, account), CONNECTED_MARK);
    if (connected) await fs.writeFile(mark, new Date().toISOString(), { mode: 0o600 });
    else await fs.rm(mark, { force: true });
  }

  async profiles(): Promise<BrowserProfile[]> {
    const root = path.join(this.paths.home, 'browser');
    const names = await fs.readdir(root).catch(() => [] as string[]);
    const found: BrowserProfile[] = [];
    for (const name of names) {
      const match = /^([a-z]+)-([a-z0-9][a-z0-9-]{0,31})$/.exec(name);
      const platform = BROWSER_PLATFORMS.find((item) => item === match?.[1]);
      if (match === null || platform === undefined || match[2] === undefined) continue;
      const connected = await fs
        .access(path.join(root, name, CONNECTED_MARK))
        .then(() => true)
        .catch(() => false);
      found.push({ platform, account: match[2], connected });
    }
    return found;
  }

  private async launch(dir: string): Promise<BrowserContext> {
    const executablePath = process.env[CHROME_ENV];
    try {
      return await chromium.launchPersistentContext(dir, {
        ...(executablePath === undefined || executablePath === ''
          ? { channel: 'chrome' }
          : { executablePath }),
        headless: process.env[VISIBLE_ENV] !== '1',
        viewport: VIEWPORT,
        locale: 'pt-BR',
        acceptDownloads: false,
      });
    } catch (error) {
      const detail = error instanceof Error ? (error.message.split('\n')[0] ?? '') : '';
      throw new AppError(
        'MISSING_DEPENDENCY',
        `não consegui abrir o Google Chrome (${detail.slice(0, 160)}); instale o Chrome ou defina ${CHROME_ENV}`,
      );
    }
  }
}
