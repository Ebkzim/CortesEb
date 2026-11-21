import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { BrowserSessions, type BrowserPlatform } from './browser-sessions.js';
import { readIdentity } from './identity.js';
import { isLoggedIn, SITES } from './sites.js';

export type LoginPhase = 'open' | 'checking' | 'connected' | 'failed';

export interface LoginWindow {
  platform: BrowserPlatform;
  account: string;
  phase: LoginPhase;
  startedAt: string;
  message: string | null;
}

const CHROME_ENV = 'CORTES_EB_CHROME';
const WINDOW_LIMIT_MS = 30 * 60_000;

export function chromeCandidates(platform: NodeJS.Platform = process.platform): string[] {
  const custom = process.env[CHROME_ENV];
  const own = custom === undefined || custom === '' ? [] : [custom];
  if (platform === 'win32') {
    const roots = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ];
    return [
      ...own,
      ...roots
        .filter((root): root is string => root !== undefined && root !== '')
        .map((root) => `${root}\\Google\\Chrome\\Application\\chrome.exe`),
    ];
  }
  if (platform === 'darwin') {
    return [...own, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }
  return [
    ...own,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
  ];
}

export function loginArgs(
  profileDir: string,
  url: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const keyStore =
    platform === 'linux'
      ? ['--password-store=basic']
      : platform === 'darwin'
        ? ['--use-mock-keychain']
        : [];
  return [
    `--user-data-dir=${profileDir}`,
    ...keyStore,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    url,
  ];
}

@Injectable()
export class LoginWindows {
  private readonly windows = new Map<string, LoginWindow>();
  private readonly children = new Map<string, ChildProcess>();

  constructor(private readonly sessions: BrowserSessions) {}

  list(): LoginWindow[] {
    return [...this.windows.values()];
  }

  async open(platform: BrowserPlatform, account: string, pageUrl?: string): Promise<LoginWindow> {
    if (pageUrl !== undefined) {
      let valid = false;
      try {
        valid =
          new URL(pageUrl).origin ===
          new URL(SITES[platform].cookieUrls[0] ?? SITES[platform].login).origin;
      } catch {
        valid = false;
      }
      if (!valid) throw new AppError('INVALID_INPUT', 'página de verificação inválida');
    }
    const key = `${platform}:${account}`;
    const current = this.windows.get(key);
    if (current !== undefined && (current.phase === 'open' || current.phase === 'checking')) {
      return current;
    }
    const chrome = chromeCandidates().find((file) => fs.existsSync(file));
    if (chrome === undefined) {
      throw new AppError(
        'MISSING_DEPENDENCY',
        `não achei o Google Chrome; instale ou defina ${CHROME_ENV}`,
      );
    }
    const lease = await this.sessions.reserve(platform, account);
    if (lease === null)
      throw new AppError(
        'PROCESS_FAILED',
        'Este perfil está em uso. Pare o aquecimento ou aguarde a publicação antes de conectar.',
      );
    const dir = this.sessions.profileDir(platform, account);
    let child: ChildProcess;
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      child = spawn(chrome, loginArgs(dir, pageUrl ?? SITES[platform].login), {
        stdio: 'ignore',
        shell: false,
        detached: false,
      });
    } catch (error) {
      await lease.release();
      throw error;
    }
    const window: LoginWindow = {
      platform,
      account,
      phase: 'open',
      startedAt: new Date().toISOString(),
      message: null,
    };
    this.windows.set(key, window);
    this.children.set(key, child);
    const limit = setTimeout(() => {
      child.kill();
    }, WINDOW_LIMIT_MS);
    limit.unref();
    child.once('error', () => {
      clearTimeout(limit);
      this.children.delete(key);
      void lease.release();
      this.finish(key, 'failed', 'não consegui abrir o Chrome');
    });
    child.once('exit', () => {
      clearTimeout(limit);
      this.children.delete(key);
      void lease.release().then(() => this.check(key, platform, account));
    });
    return window;
  }

  private async check(key: string, platform: BrowserPlatform, account: string): Promise<void> {
    this.finish(key, 'checking', null);
    try {
      const found = await this.sessions.with(platform, account, async (page, context) => {
        if (!(await isLoggedIn(SITES[platform], context))) return null;
        return { identity: await readIdentity(platform, page) };
      });
      const ok = found !== null;
      await this.sessions.markConnected(platform, account, ok, found?.identity);
      this.finish(
        key,
        ok ? 'connected' : 'failed',
        ok ? null : `a janela fechou sem login no ${SITES[platform].label}; tente de novo`,
      );
    } catch (error) {
      this.finish(
        key,
        'failed',
        error instanceof Error ? (error.message.split('\n')[0] ?? 'erro') : 'erro',
      );
    }
  }

  private finish(key: string, phase: LoginPhase, message: string | null): void {
    const window = this.windows.get(key);
    if (window === undefined) return;
    this.windows.set(key, { ...window, phase, message });
  }
}
