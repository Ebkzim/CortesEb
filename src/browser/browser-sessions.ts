import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { AppError } from '../common/app-error.js';
import { resolveInside } from '../common/safe-path.js';
import { AppPaths } from '../config/app-paths.js';
import { z } from 'zod';
import { ACCOUNT_REF_PATTERN } from '../contracts/cuts.js';
import type { Identity } from './identity.js';

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
  handle: string | null;
  url: string | null;
  connectedAt: string | null;
}

const markSchema = z.object({
  connectedAt: z.string().max(40),
  handle: z.string().max(80).nullable().default(null),
  url: z.url().max(300).nullable().default(null),
});

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
    identity?: Identity | null,
  ): Promise<void> {
    const mark = path.join(this.profileDir(platform, account), CONNECTED_MARK);
    if (!connected) {
      await fs.rm(mark, { force: true });
      return;
    }
    const previous = await readMark(mark);
    const next = {
      connectedAt: new Date().toISOString(),
      handle: identity?.handle ?? previous?.handle ?? null,
      url: identity?.url ?? previous?.url ?? null,
    };
    await fs.writeFile(mark, JSON.stringify(next), { mode: 0o600 });
  }

  async forget(platform: BrowserPlatform, account: string): Promise<void> {
    const dir = this.profileDir(platform, account);
    const previous = this.locks.get(dir) ?? Promise.resolve();
    const run = previous.then(() => fs.rm(dir, { recursive: true, force: true }));
    this.locks.set(
      dir,
      run.catch(() => undefined),
    );
    await run;
  }

  async profiles(): Promise<BrowserProfile[]> {
    const root = path.join(this.paths.home, 'browser');
    const names = await fs.readdir(root).catch(() => [] as string[]);
    const found: BrowserProfile[] = [];
    for (const name of names) {
      const match = /^([a-z]+)-([a-z0-9][a-z0-9-]{0,31})$/.exec(name);
      const platform = BROWSER_PLATFORMS.find((item) => item === match?.[1]);
      if (match === null || platform === undefined || match[2] === undefined) continue;
      const mark = await readMark(path.join(root, name, CONNECTED_MARK));
      found.push({
        platform,
        account: match[2],
        connected: mark !== null,
        handle: mark?.handle ?? null,
        url: mark?.url ?? null,
        connectedAt: mark?.connectedAt ?? null,
      });
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

async function readMark(file: string): Promise<z.infer<typeof markSchema> | null> {
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  try {
    const parsed = markSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
  } catch {
    return { connectedAt: text.trim().slice(0, 40), handle: null, url: null };
  }
  return { connectedAt: text.trim().slice(0, 40), handle: null, url: null };
}
