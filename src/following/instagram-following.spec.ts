import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { chromeCandidates } from '../browser/login-windows.js';
import type { WarmingBrowser } from '../warming/warming-browser.js';
import {
  followersResult,
  instagramUsername,
  isFollowersSearch,
  InstagramFollowingBrowser,
} from './instagram-following.js';

import { followingConfigSchema, type FollowingSession } from './following-state.js';

const executablePath = chromeCandidates().find((candidate) => fs.existsSync(candidate));

describe('Instagram relationship evidence', () => {
  it('accepts only actual Instagram profile paths', () => {
    expect(instagramUsername('/Some.Name/')).toBe('some.name');
    for (const path of [
      '/accounts/',
      '/reels/',
      '/reel/video/',
      'https://example.com/name/',
      '/name/followers/',
    ])
      expect(instagramUsername(path)).toBeNull();
  });
  it('correlates negative membership with the exact followers search', () => {
    expect(
      isFollowersSearch(
        'https://www.instagram.com/api/v1/friendships/123/followers/?query=Alice',
        'alice',
      ),
    ).toBe(true);
    expect(
      isFollowersSearch(
        'https://www.instagram.com/api/v1/friendships/123/following/?query=alice',
        'alice',
      ),
    ).toBe(false);
    expect(
      isFollowersSearch(
        'https://www.instagram.com/api/v1/friendships/123/followers/?query=other',
        'alice',
      ),
    ).toBe(false);
    expect(
      isFollowersSearch(
        'https://example.com/api/v1/friendships/123/followers/?query=alice',
        'alice',
      ),
    ).toBe(false);
    expect(followersResult({ users: [{ username: 'ALICE' }] }, 'alice')).toBe('yes');
    expect(followersResult({ users: [], status: 'ok' }, 'alice')).toBe('no');
    for (const data of [
      {},
      { users: [{ username: 'other' }] },
      { users: [], next_max_id: 'more' },
      { users: [], more_available: true },
      { users: [], status: 'fail' },
    ])
      expect(followersResult(data, 'alice')).toBe('unknown');
  });
});

describe.skipIf(executablePath === undefined)('Instagram relationship controls in Chrome', () => {
  let browser: Browser | undefined;
  let page: Page;
  let controls: InstagramFollowingBrowser;
  const warming = {
    clear: vi.fn(() => Promise.resolve(undefined)),
    next: vi.fn(() => Promise.resolve('https://www.instagram.com/reel/sample')),
    prepare: vi.fn(() => Promise.resolve(null)),
  };
  beforeAll(async () => {
    if (!executablePath) throw new Error('Chrome indisponível');
    browser = await chromium.launch({ executablePath, headless: true, timeout: 30_000 });
  }, 45_000);
  beforeEach(async () => {
    if (!browser) throw new Error('Chrome dos testes indisponível');
    page = await browser.newPage();
    controls = new InstagramFollowingBrowser(warming as unknown as WarmingBrowser);
  });
  afterEach(async () => {
    await page.close();
  });
  afterAll(async () => {
    await browser?.close();
  });
  async function profilePage(button: string, script: string): Promise<void> {
    await page.route('https://www.instagram.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<main><header><h2>alice</h2><button id="relation">${button}</button></header><section>Sugestões<button onclick="document.body.dataset.wrong='true'">Seguir</button></section></main><script>${script}</script>`,
      }),
    );
  }
  it('discovers comment authors without selecting caption or suggestion profiles', async () => {
    await page.setContent(
      '<main data-cortes-current-item><div role="dialog"><a href="/caption/">Caption author</a><ul><li><a href="/Person/">Person</a><span><a href="/p/post/c/123/">1h</a></span><p>Comentário</p></li></ul><a href="/suggestion/">Sugestão</a></div></main>',
    );
    const session: FollowingSession = {
      account: 'canal',
      platform: 'instagram',
      config: followingConfigSchema.parse({}),
      status: 'running',
      counts: { follow: 0, requested: 0, unfollow: 0 },
      nextAt: '',
      startedAt: '',
      message: '',
      progress: { stage: 'queued', username: null, until: null },
      lastIntervalSeconds: null,
      candidates: [],
      checked: [],
      reels: [],
      ledger: [],
      history: [],
    };
    const found = await controls.discover(
      page,
      page.context(),
      session,
      'owner',
      () => Promise.resolve(undefined),
      new AbortController().signal,
    );
    expect(found.usernames).toEqual(['person']);
  });

  it('follows the profile header and confirms a private request, ignoring suggestions', async () => {
    await profilePage(
      'Seguir',
      'document.querySelector("#relation").onclick = e => e.target.textContent = "Solicitado";',
    );
    const target = await controls.profile(page, page.context(), 'alice');
    expect(target.relation).toBe('follow');
    expect(
      await controls.perform(
        page,
        page.context(),
        target.header,
        'follow',
        new AbortController().signal,
      ),
    ).toBe('requested');
    expect(await page.locator('body').getAttribute('data-wrong')).toBeNull();
  });
  it('confirms unfollow through the menu and checks the final profile state', async () => {
    await profilePage(
      'Seguindo',
      `document.querySelector('#relation').onclick = () => { const dialog = document.createElement('div'); dialog.setAttribute('role','dialog'); dialog.innerHTML='<button>Deixar de seguir</button>'; dialog.querySelector('button').onclick=()=>{document.querySelector('#relation').textContent='Seguir';dialog.remove();}; document.body.append(dialog); };`,
    );
    const target = await controls.profile(page, page.context(), 'alice');
    expect(
      await controls.perform(
        page,
        page.context(),
        target.header,
        'unfollow',
        new AbortController().signal,
      ),
    ).toBe('unfollowed');
    expect(await page.locator('body').getAttribute('data-wrong')).toBeNull();
  });
  it('aborts before clicking when Stop was requested', async () => {
    await profilePage(
      'Seguir',
      'document.querySelector("#relation").onclick=()=>document.body.dataset.clicked="true";',
    );
    const target = await controls.profile(page, page.context(), 'alice');
    const controller = new AbortController();
    controller.abort();
    await expect(
      controls.perform(page, page.context(), target.header, 'follow', controller.signal),
    ).rejects.toThrow();
    expect(await page.locator('body').getAttribute('data-clicked')).toBeNull();
  });
  it('requires both the current empty search response and the no-results display', async () => {
    await page.route('https://www.instagram.com/**', async (route) => {
      if (route.request().url().includes('/api/')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ users: [], status: 'ok' }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'text/html',
        body: `<main><header><a href="/accounts/edit/">Editar perfil</a><a href="/owner/followers/" onclick="event.preventDefault(); document.querySelector('[role=dialog]').hidden=false">Seguidores</a></header></main><div role="dialog" hidden><input placeholder="Pesquisar" /><div id="results"><a href="/other/">other</a></div></div><script>document.querySelector('input').oninput = async e => { const data = await fetch('/api/v1/friendships/123/followers/?query='+encodeURIComponent(e.target.value)).then(r=>r.json()); if (!data.users.length) document.querySelector('#results').textContent='Nenhum resultado encontrado.'; };</script>`,
      });
    });
    expect(
      await controls.membership(
        page,
        page.context(),
        'owner',
        'alice',
        new AbortController().signal,
      ),
    ).toBe('no');
  });
  it('keeps unknown membership when no correlated response proves absence', async () => {
    await page.route('https://www.instagram.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main><header><a href="/accounts/edit/">Editar perfil</a><a href="/owner/followers/" onclick="event.preventDefault(); document.querySelector(\'[role=dialog]\').hidden=false">Seguidores</a></header></main><div role="dialog" hidden><input placeholder="Pesquisar" /><p>Nenhum resultado encontrado.</p></div>',
      }),
    );
    const wait = vi.spyOn(page, 'waitForTimeout').mockResolvedValue(undefined);
    expect(
      await controls.membership(
        page,
        page.context(),
        'owner',
        'alice',
        new AbortController().signal,
      ),
    ).toBe('unknown');
    wait.mockRestore();
  });
});
