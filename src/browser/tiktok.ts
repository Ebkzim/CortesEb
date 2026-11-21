import { Injectable } from '@nestjs/common';
import type { BrowserContext, Page } from 'playwright-core';
import { AppError } from '../common/app-error.js';
import { BrowserSessions } from './browser-sessions.js';
import { RemoteDesk } from './remote-desk.js';

export const TIKTOK_HOME = 'https://www.tiktok.com';
export const TIKTOK_LOGIN = 'https://www.tiktok.com/login';
export const TIKTOK_UPLOAD = 'https://www.tiktok.com/tiktokstudio/upload?from=webapp';
export const TIKTOK_CONTENT = 'https://www.tiktok.com/tiktokstudio/content';

export const CHECK_WAIT_MS = 15 * 60_000;

const CHALLENGE_SELECTOR = [
  '[id*="captcha" i]',
  '[class*="captcha" i]',
  'iframe[src*="captcha" i]',
  'iframe[src*="verify" i]',
  '[class*="secsdk" i]',
].join(', ');

export async function isLoggedIn(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies(TIKTOK_HOME);
  return cookies.some((cookie) => cookie.name === 'sessionid' && cookie.value !== '');
}

export async function hasChallenge(page: Page): Promise<boolean> {
  const boxes = page.locator(CHALLENGE_SELECTOR);
  const count = Math.min(await boxes.count().catch(() => 0), 10);
  for (let index = 0; index < count; index += 1) {
    if (
      await boxes
        .nth(index)
        .isVisible()
        .catch(() => false)
    )
      return true;
  }
  return false;
}

export function onLoginPage(page: Page): boolean {
  try {
    return new URL(page.url()).pathname.startsWith('/login');
  } catch {
    return false;
  }
}

@Injectable()
export class TikTokSession {
  constructor(
    private readonly sessions: BrowserSessions,
    private readonly desk: RemoteDesk,
  ) {}

  async ensureClear(page: Page, context: BrowserContext, account: string): Promise<void> {
    if (onLoginPage(page) || !(await isLoggedIn(context))) {
      await this.sessions.markConnected('tiktok', account, false);
      this.desk.alert(
        'TikTok desconectado',
        `A conta ${account} saiu da sessão do TikTok. Reconecte em Publicar → Conectar TikTok.`,
      );
      throw new AppError(
        'NOT_CONFIGURED',
        `o TikTok da conta ${account} saiu da sessão; reconecte no painel (Publicar → Conectar TikTok)`,
      );
    }
    if (await hasChallenge(page)) {
      const ok = await this.desk.request(page, {
        reason: 'captcha',
        platform: 'tiktok',
        account,
        message: `O TikTok pediu uma verificação na conta ${account}. Resolva no painel.`,
        solved: async () => !(await hasChallenge(page)),
        timeoutMs: CHECK_WAIT_MS,
      });
      if (!ok) throw new AppError('PROCESS_FAILED', 'a verificação do TikTok não foi resolvida');
    }
  }
}
