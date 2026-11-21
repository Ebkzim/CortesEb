import { Injectable } from '@nestjs/common';
import type { BrowserContext, Page } from 'playwright-core';
import { AppError } from '../common/app-error.js';
import { BrowserSessions, type BrowserPlatform } from './browser-sessions.js';
import { RemoteDesk } from './remote-desk.js';

export const CHECK_WAIT_MS = 15 * 60_000;

export interface Site {
  platform: BrowserPlatform;
  label: string;
  login: string;
  cookieUrls: string[];
  sessionCookies: string[];
  challenge: string;
  loginPage: (url: URL) => boolean;
  checkPage: (url: URL) => boolean;
}

export const SITES: Record<BrowserPlatform, Site> = {
  tiktok: {
    platform: 'tiktok',
    label: 'TikTok',
    login: 'https://www.tiktok.com/login',
    cookieUrls: ['https://www.tiktok.com'],
    sessionCookies: ['sessionid'],
    challenge: [
      '[id*="captcha" i]',
      '[class*="captcha" i]',
      'iframe[src*="captcha" i]',
      'iframe[src*="verify" i]',
      '[class*="secsdk" i]',
    ].join(', '),
    loginPage: (url) => url.pathname.startsWith('/login'),
    checkPage: () => false,
  },
  instagram: {
    platform: 'instagram',
    label: 'Instagram',
    login: 'https://www.instagram.com/accounts/login/',
    cookieUrls: ['https://www.instagram.com'],
    sessionCookies: ['sessionid'],
    challenge: ['iframe[src*="recaptcha" i]', 'iframe[src*="captcha" i]', '[id*="captcha" i]'].join(
      ', ',
    ),
    loginPage: (url) => url.pathname.startsWith('/accounts/login'),
    checkPage: (url) =>
      ['/challenge', '/accounts/suspended', '/auth_platform', '/accounts/onetap'].some((prefix) =>
        url.pathname.startsWith(prefix),
      ),
  },
  youtube: {
    platform: 'youtube',
    label: 'YouTube',
    login:
      'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fstudio.youtube.com%2F',
    cookieUrls: ['https://www.youtube.com', 'https://accounts.google.com'],
    sessionCookies: ['SID', '__Secure-3PSID'],
    challenge: ['iframe[src*="recaptcha" i]', 'iframe[title*="recaptcha" i]'].join(', '),
    loginPage: () => false,
    checkPage: (url) => url.hostname === 'accounts.google.com',
  },
};

export async function isLoggedIn(site: Site, context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies(site.cookieUrls);
  return cookies.some((cookie) => site.sessionCookies.includes(cookie.name) && cookie.value !== '');
}

export async function hasChallenge(site: Site, page: Page): Promise<boolean> {
  const boxes = page.locator(site.challenge);
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

function pageUrl(page: Page): URL | null {
  try {
    return new URL(page.url());
  } catch {
    return null;
  }
}

export function onLoginPage(site: Site, page: Page): boolean {
  const url = pageUrl(page);
  return url !== null && site.loginPage(url);
}

export function onCheckPage(site: Site, page: Page): boolean {
  const url = pageUrl(page);
  return url !== null && site.checkPage(url);
}

@Injectable()
export class SiteSession {
  constructor(
    private readonly sessions: BrowserSessions,
    private readonly desk: RemoteDesk,
  ) {}

  async ensureClear(
    platform: BrowserPlatform,
    page: Page,
    context: BrowserContext,
    account: string,
  ): Promise<void> {
    const site = SITES[platform];
    if (onLoginPage(site, page) || !(await isLoggedIn(site, context))) {
      await this.sessions.markConnected(platform, account, false);
      this.desk.alert(
        `${site.label} desconectado`,
        `A conta ${account} saiu da sessão do ${site.label}. Reconecte em Publicar → Conectar ${site.label}.`,
      );
      throw new AppError(
        'NOT_CONFIGURED',
        `o ${site.label} da conta ${account} saiu da sessão; reconecte no painel (Publicar → Conectar ${site.label})`,
      );
    }
    const checkPage = onCheckPage(site, page);
    if (checkPage || (await hasChallenge(site, page))) {
      const ok = await this.desk.request(page, {
        reason: checkPage ? 'verify' : 'captcha',
        platform,
        account,
        message: `O ${site.label} pediu uma verificação na conta ${account}. Resolva no painel.`,
        solved: async () => !onCheckPage(site, page) && !(await hasChallenge(site, page)),
        timeoutMs: CHECK_WAIT_MS,
      });
      if (!ok) {
        throw new AppError('PROCESS_FAILED', `a verificação do ${site.label} não foi resolvida`);
      }
    }
  }
}
