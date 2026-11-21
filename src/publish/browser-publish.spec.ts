import type { BrowserContext, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { Output } from '../common/output.js';
import type { AppPaths } from '../config/app-paths.js';
import { PUBLISHING_DEFAULTS, userConfigSchema } from '../config/user-config.js';
import { isLoggedIn, onCheckPage, onLoginPage, SITES } from '../browser/sites.js';
import { loginArgs } from '../browser/login-windows.js';
import type { BrowserTools } from './browser-tools.js';
import type { CredentialVault } from './credential-vault.js';
import { InstagramPublisher } from './instagram-publisher.js';
import { InstagramWebPublisher } from './instagram-web-publisher.js';
import type { OutboxPublisher } from './outbox-publisher.js';
import { methodOf, methodsOf } from './publish-method.js';
import { PublishWorker } from './publish-worker.js';
import type { QueueStore } from './queue-store.js';
import { TikTokPublisher } from './tiktok-publisher.js';
import { YoutubePublisher } from './youtube-publisher.js';
import { shortsUrl, YoutubeWebPublisher, youtubeText } from './youtube-web-publisher.js';

function context(cookies: { name: string; value: string }[]): BrowserContext {
  return { cookies: () => Promise.resolve(cookies) } as unknown as BrowserContext;
}

function at(url: string): Page {
  return { url: () => url } as unknown as Page;
}

describe('browser sites', () => {
  it('reads the session cookie of each site', async () => {
    expect(await isLoggedIn(SITES.tiktok, context([{ name: 'sessionid', value: 'x' }]))).toBe(true);
    expect(await isLoggedIn(SITES.instagram, context([{ name: 'sessionid', value: '' }]))).toBe(
      false,
    );
    expect(await isLoggedIn(SITES.youtube, context([{ name: '__Secure-3PSID', value: 'x' }]))).toBe(
      true,
    );
    expect(await isLoggedIn(SITES.youtube, context([{ name: 'sessionid', value: 'x' }]))).toBe(
      false,
    );
  });

  it('tells login pages from verification pages', () => {
    expect(onLoginPage(SITES.instagram, at('https://www.instagram.com/accounts/login/'))).toBe(
      true,
    );
    expect(onCheckPage(SITES.instagram, at('https://www.instagram.com/challenge/abc/'))).toBe(true);
    expect(onCheckPage(SITES.instagram, at('https://www.instagram.com/'))).toBe(false);
    expect(onCheckPage(SITES.youtube, at('https://accounts.google.com/v3/signin'))).toBe(true);
    expect(onCheckPage(SITES.youtube, at('https://studio.youtube.com/channel/x'))).toBe(false);
    expect(onLoginPage(SITES.tiktok, at('https://www.tiktok.com/login/phone'))).toBe(true);
  });

  it('opens the login window on the site of each platform', () => {
    expect(loginArgs('/p', SITES.youtube.login, 'linux').at(-1)).toMatch(
      /^https:\/\/accounts\.google\.com\//,
    );
    expect(loginArgs('/p', SITES.instagram.login, 'linux').at(-1)).toBe(
      'https://www.instagram.com/accounts/login/',
    );
  });
});

describe('publish method', () => {
  it('defaults to the official api on instagram and the browser elsewhere', () => {
    expect(userConfigSchema.parse({}).publishing).toEqual(PUBLISHING_DEFAULTS);
    expect(methodsOf(PUBLISHING_DEFAULTS)).toEqual({
      youtube: 'browser',
      instagram: 'api',
      tiktok: 'browser',
    });
    expect(methodOf({ ...PUBLISHING_DEFAULTS, instagram: 'browser' }, 'instagram')).toBe('browser');
  });

  it('picks the publisher that matches the configured method', () => {
    const browser = {
      paths: { home: '/h' } as AppPaths,
      sessions: {},
      site: {},
      server: {},
    } as unknown as BrowserTools;
    const worker = new PublishWorker(
      {} as QueueStore,
      {} as OutboxPublisher,
      {} as Output,
      {} as CredentialVault,
      browser,
    );
    const live = {
      once: true,
      intervalMs: 1,
      maxAttempts: 1,
      baseBackoffMs: 1,
      mode: 'live' as const,
    };
    const web = { ...PUBLISHING_DEFAULTS, instagram: 'browser' as const };
    const api = { ...PUBLISHING_DEFAULTS, youtube: 'api' as const };
    expect(worker.publisherFor('tiktok', live, api)).toBeInstanceOf(TikTokPublisher);
    expect(worker.publisherFor('instagram', live, web)).toBeInstanceOf(InstagramWebPublisher);
    expect(worker.publisherFor('instagram', live, api)).toBeInstanceOf(InstagramPublisher);
    expect(worker.publisherFor('youtube', live, web)).toBeInstanceOf(YoutubeWebPublisher);
    expect(worker.publisherFor('youtube', live, api)).toBeInstanceOf(YoutubePublisher);
  });
});

describe('youtube studio text', () => {
  it('drops angle brackets and keeps the limit', () => {
    expect(youtubeText('a <b> c', 100)).toBe('a b c');
    expect(youtubeText('x'.repeat(150), 100)).toHaveLength(100);
  });

  it('turns any video link into a shorts url', () => {
    expect(shortsUrl('https://youtu.be/AbC_12-xyz')).toBe(
      'https://www.youtube.com/shorts/AbC_12-xyz',
    );
    expect(shortsUrl('https://www.youtube.com/shorts/AbC_12-xyz')).toBe(
      'https://www.youtube.com/shorts/AbC_12-xyz',
    );
    expect(shortsUrl(null)).toBeNull();
    expect(shortsUrl('https://studio.youtube.com/')).toBeNull();
  });
});
