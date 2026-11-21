import type { Page } from 'playwright-core';
import type { BrowserPlatform } from './browser-sessions.js';

export interface Identity {
  handle: string;
  url: string;
}

const WAIT_MS = 20_000;
const TIKTOK_PROFILE = /^\/@([A-Za-z0-9._]{1,30})\/?$/;
const INSTAGRAM_PROFILE = /^\/([A-Za-z0-9._]{1,30})\/?$/;
const STUDIO_CHANNEL = /^\/channel\/(UC[A-Za-z0-9_-]{10,40})/;
const PROFILE_TEXT = /^(perfil|profile)$/i;
const SKIP_TEXT =
  /^(skip to youtube studio|pular para o youtube studio|ir para o youtube studio)$/i;

export function identityFromUrl(platform: BrowserPlatform, href: string): Identity | null {
  let url: URL;
  try {
    url = new URL(href, 'https://invalid.local');
  } catch {
    return null;
  }
  if (platform === 'tiktok') {
    const handle = TIKTOK_PROFILE.exec(url.pathname)?.[1];
    return handle === undefined ? null : { handle, url: `https://www.tiktok.com/@${handle}` };
  }
  if (platform === 'instagram') {
    const handle = INSTAGRAM_PROFILE.exec(url.pathname)?.[1];
    return handle === undefined ? null : { handle, url: `https://www.instagram.com/${handle}/` };
  }
  const channel = STUDIO_CHANNEL.exec(url.pathname)?.[1];
  return channel === undefined
    ? null
    : { handle: channel, url: `https://www.youtube.com/channel/${channel}` };
}

export async function readIdentity(
  platform: BrowserPlatform,
  page: Page,
): Promise<Identity | null> {
  try {
    if (platform === 'tiktok') return await tiktok(page);
    if (platform === 'instagram') return await instagram(page);
    return await youtube(page);
  } catch {
    return null;
  }
}

async function tiktok(page: Page): Promise<Identity | null> {
  await page.goto('https://www.tiktok.com/profile', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/tiktok\.com\/@/, { timeout: WAIT_MS }).catch(() => undefined);
  return identityFromUrl('tiktok', page.url());
}

async function instagram(page: Page): Promise<Identity | null> {
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
  const link = page.locator('a[href]').filter({ hasText: PROFILE_TEXT }).first();
  const href = await link.getAttribute('href', { timeout: WAIT_MS });
  return href === null ? null : identityFromUrl('instagram', href);
}

async function youtube(page: Page): Promise<Identity | null> {
  await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline && !STUDIO_CHANNEL.test(new URL(page.url()).pathname)) {
    const skip = page.getByText(SKIP_TEXT).first();
    if (await skip.isVisible().catch(() => false)) {
      await skip.click({ timeout: 5_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(1_000);
  }
  const found = identityFromUrl('youtube', page.url());
  if (found === null) return null;
  const name = await page
    .locator('#entity-name')
    .first()
    .innerText({ timeout: 10_000 })
    .catch(() => '');
  const clean = name.trim().slice(0, 60);
  return clean === '' ? found : { ...found, handle: clean };
}
