import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { BrowserContext, Locator, Page, Response } from 'playwright-core';
import { readIdentity } from '../browser/identity.js';
import { WarmingBrowser } from '../warming/warming-browser.js';
import { emptyCounts, warmingConfigSchema, type WarmingSession } from '../warming/warming-state.js';
import type { FollowingSession } from './following-state.js';

const FOLLOW = /^(seguir(?: de volta)?|follow(?: back)?)$/i;
const FOLLOWING = /^(seguindo|following)(?:\s|$)/i;
const REQUESTED = /^(solicitado|requested)$/i;
const UNFOLLOW = /^(deixar de seguir|unfollow)$/i;
const EMPTY =
  /nenhum (?:usuário|resultado)|nenhuma pessoa|no (?:users|results)|não encontramos|não há resultados/i;
const RESERVED = new Set([
  'accounts',
  'explore',
  'reel',
  'reels',
  'p',
  'direct',
  'stories',
  'about',
  'legal',
  'privacy',
  'web',
  'challenge',
  'challenge_popup',
  'developer',
  'your_activity',
  'notifications',
]);
export type Relation = 'follow' | 'following' | 'requested';
export type Membership = 'yes' | 'no' | 'unknown';
type Report = (stage: string, message: string, username?: string) => Promise<void>;

export function instagramUsername(href: string): string | null {
  try {
    const url = new URL(href, 'https://www.instagram.com/');
    if (url.hostname !== 'www.instagram.com' && url.hostname !== 'instagram.com') return null;
    const username = /^\/([a-z0-9._]{1,30})\/?$/i.exec(url.pathname)?.[1]?.toLowerCase();
    return username && !RESERVED.has(username) ? username : null;
  } catch {
    return null;
  }
}
export function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

export function isFollowersSearch(href: string, username: string): boolean {
  try {
    const url = new URL(href);
    return (
      (url.hostname === 'www.instagram.com' || url.hostname === 'i.instagram.com') &&
      /^\/api\/v1\/friendships\/\d+\/followers\/?$/.test(url.pathname) &&
      url.searchParams.get('query')?.toLowerCase() === username.toLowerCase()
    );
  } catch {
    return false;
  }
}
export function followersResult(data: unknown, username: string): Membership {
  if (!data || typeof data !== 'object' || !('users' in data) || !Array.isArray(data.users))
    return 'unknown';
  if (
    data.users.some(
      (item: unknown) =>
        item !== null &&
        typeof item === 'object' &&
        'username' in item &&
        typeof item.username === 'string' &&
        item.username.toLowerCase() === username.toLowerCase(),
    )
  )
    return 'yes';
  if (
    data.users.length !== 0 ||
    ('next_max_id' in data && data.next_max_id) ||
    ('more_available' in data && data.more_available === true) ||
    ('has_more' in data && data.has_more === true)
  )
    return 'unknown';
  if ('status' in data && data.status !== 'ok') return 'unknown';
  return 'no';
}

@Injectable()
export class InstagramFollowingBrowser {
  constructor(private readonly warming: WarmingBrowser) {}

  async self(page: Page, context: BrowserContext, hint: string | null): Promise<string> {
    let username = hint
      ? instagramUsername(`https://www.instagram.com/${hint.replace(/^@/, '')}/`)
      : null;
    if (username) {
      await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
      await this.clear(page, context);
      if (await this.ownProfile(page, username)) return username;
    }
    const identity = await readIdentity('instagram', page);
    username = identity ? instagramUsername(identity.url) : null;
    if (!username)
      throw new Error('Não consegui identificar o perfil conectado. Confira a conta em Conectar.');
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
    await this.clear(page, context);
    if (!(await this.ownProfile(page, username)))
      throw new Error('O perfil aberto não foi confirmado como a conta conectada.');
    return username;
  }

  async discover(
    page: Page,
    context: BrowserContext,
    session: FollowingSession,
    self: string,
    report: Report,
    signal: AbortSignal,
  ): Promise<{ usernames: string[]; reel: string | null }> {
    if (session.config.mode === 'unfollow') {
      await report('discovering', 'Carregando a lista de pessoas que esta conta segue.');
      const dialog = await this.listDialog(page, context, self, 'following');
      const excluded = new Set([
        ...session.checked,
        self,
        ...session.ledger
          .filter((e) => e.mode === 'unfollow' && e.state === 'pending')
          .map((e) => e.username),
      ]);
      for (let attempt = 0; attempt < 24; attempt++) {
        signal.throwIfAborted();
        await this.clear(page, context);
        const usernames = (await this.profileLinks(dialog)).filter((name) => !excluded.has(name));
        if (usernames.length) return { usernames: shuffled(usernames), reel: null };
        await scrollList(dialog);
        await page.waitForTimeout(session.config.searchMode === 'economy' ? 1600 : 800);
      }
      throw new Error(
        'Não encontrei novos perfis elegíveis na lista Seguindo. Nenhuma remoção foi feita neste ciclo.',
      );
    }
    const fake: WarmingSession = {
      account: session.account,
      platform: 'instagram',
      config: warmingConfigSchema.parse({ searchMode: session.config.searchMode }),
      status: 'running',
      counts: emptyCounts(),
      day: '',
      startedAt: session.startedAt,
      nextAt: session.nextAt,
      message: null,
      history: [],
      seen: session.reels.map((url) => `views:${url}`),
    };
    const excluded = new Set([
      self,
      ...session.checked,
      ...session.ledger
        .filter((e) => e.mode === 'follow' && e.state === 'pending')
        .map((e) => e.username),
    ]);
    for (let attempt = 0; attempt < 4; attempt++) {
      signal.throwIfAborted();
      await report('discovering', 'Buscando perfis aleatórios nos comentários dos Reels.');
      const url = await this.warming.next(page, fake);
      fake.seen.push(`views:${url}`);
      await this.warming.prepare(page, 'instagram', url, 'views', session.config.searchMode);
      await this.clear(page, context);
      const root = page.locator('[data-cortes-current-item]').first();
      const scope = (await root.count()) ? root : page.locator('main').first();
      const panel = page.getByRole('dialog').filter({ visible: true }).first();
      if (!(await panel.isVisible())) {
        const open = scope
          .getByRole('button', { name: /^(comentar|comment|comments)\b/i })
          .filter({ visible: true })
          .first();
        if (!(await open.isVisible())) continue;
        await open.click({ timeout: 5000 });
        await panel.waitFor({ state: 'visible', timeout: 10_000 });
      }
      await page.locator('video, audio').evaluateAll((players) => {
        for (const player of players) (player as unknown as { pause(): void }).pause();
      });
      await panel
        .locator('a[href*="/c/"]')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => undefined);
      const hrefs = await panel.locator('a[href*="/c/"]').evaluateAll((links) =>
        links.flatMap((link) => {
          for (
            let row = link.parentElement, depth = 0;
            row && depth < 10;
            row = row.parentElement, depth++
          ) {
            const profiles = [...row.querySelectorAll('a[href]')].filter((a) =>
              /^\/[a-z0-9._]{1,30}\/?$/i.test(a.getAttribute('href') ?? ''),
            );
            if (profiles.length) return profiles.map((a) => a.getAttribute('href') ?? '');
          }
          return [];
        }),
      );
      const names = [
        ...new Set(hrefs.map(instagramUsername).filter((name): name is string => name !== null)),
      ].filter((name) => !excluded.has(name));
      if (names.length) return { usernames: shuffled(names), reel: url };
      await report(
        'discovering',
        'Este Reel não disponibilizou novos perfis nos comentários. Procurando outro.',
      );
    }
    throw new Error(
      'Não encontrei novos perfis nos comentários dos Reels consultados. Tente novamente depois de conferir o feed.',
    );
  }

  async membership(
    page: Page,
    context: BrowserContext,
    self: string,
    username: string,
    signal: AbortSignal,
  ): Promise<Membership> {
    const dialog = await this.listDialog(page, context, self, 'followers');
    const search = dialog
      .getByRole('textbox')
      .or(dialog.getByRole('searchbox'))
      .or(dialog.locator('input[placeholder*="Pesquisar"], input[placeholder*="Search"]'))
      .filter({ visible: true })
      .first();
    if (!(await search.isVisible())) return 'unknown';
    await search.fill('', { timeout: 5000 });
    const observed: { result: Membership } = { result: 'unknown' };
    const response = (value: Response): void => {
      if (!isFollowersSearch(value.url(), username) || value.status() !== 200) return;
      void value
        .json()
        .then((data: unknown) => {
          observed.result = followersResult(data, username);
        })
        .catch(() => undefined);
    };
    page.on('response', response);
    try {
      await search.fill(username, { timeout: 5000 });
      for (let attempt = 0; attempt < 20; attempt++) {
        signal.throwIfAborted();
        await this.clear(page, context);
        const names = await this.profileLinks(dialog);
        if (names.includes(username)) return 'yes';
        if (observed.result === 'yes') return 'yes';
        if (observed.result === 'no' && EMPTY.test(await dialog.innerText({ timeout: 2000 })))
          return 'no';
        await page.waitForTimeout(500);
      }
      return 'unknown';
    } finally {
      page.off('response', response);
    }
  }

  async profile(
    page: Page,
    context: BrowserContext,
    username: string,
  ): Promise<{ header: Locator; relation: Relation }> {
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
    await this.clear(page, context);
    if (instagramUsername(page.url()) !== username)
      throw new Error('O endereço do perfil mudou. Nenhuma ação foi enviada.');
    const header = page.locator('main header').filter({ visible: true }).first();
    await header.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
      throw new Error('O cabeçalho deste perfil não carregou. Nenhuma ação foi enviada.');
    });
    for (let attempt = 0; attempt < 12; attempt++) {
      const relation = await this.relation(header);
      if (relation) return { header, relation };
      await page.waitForTimeout(500);
    }
    throw new Error('Não consegui confirmar o estado Seguir/Seguindo deste perfil.');
  }

  async perform(
    page: Page,
    context: BrowserContext,
    header: Locator,
    mode: 'follow' | 'unfollow',
    signal: AbortSignal,
  ): Promise<'following' | 'requested' | 'unfollowed'> {
    await this.clear(page, context);
    signal.throwIfAborted();
    const expected = mode === 'follow' ? 'follow' : 'following';
    if ((await this.relation(header)) !== expected)
      throw new Error('O estado do perfil mudou antes da ação. Confira a página.');
    const button = header
      .getByRole('button', { name: mode === 'follow' ? FOLLOW : FOLLOWING })
      .filter({ visible: true })
      .first();
    await button.click({ timeout: 5000 });
    if (mode === 'unfollow') {
      const confirm = page
        .getByRole('dialog')
        .filter({ visible: true })
        .getByRole('button', { name: UNFOLLOW })
        .first();
      const menu = page.getByRole('menuitem', { name: UNFOLLOW }).filter({ visible: true }).first();
      const popup = page.getByRole('button', { name: UNFOLLOW }).filter({ visible: true }).first();
      for (let attempt = 0; attempt < 10; attempt++) {
        signal.throwIfAborted();
        await this.clear(page, context);
        if ((await this.relation(header)) === 'follow') return 'unfollowed';
        const target = (await confirm.isVisible())
          ? confirm
          : (await menu.isVisible())
            ? menu
            : popup;
        if (await target.isVisible()) {
          await target.click({ timeout: 5000 });
          break;
        }
        await page.waitForTimeout(300);
      }
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      signal.throwIfAborted();
      await this.clear(page, context);
      const relation = await this.relation(header);
      if (mode === 'follow' && (relation === 'following' || relation === 'requested'))
        return relation;
      if (mode === 'unfollow' && relation === 'follow') return 'unfollowed';
      await page.waitForTimeout(500);
    }
    throw new Error(
      'A alteração não foi confirmada pela página. Esta tentativa não será repetida automaticamente.',
    );
  }

  private async relation(header: Locator): Promise<Relation | null> {
    for (const [name, pattern] of [
      ['requested', REQUESTED],
      ['following', FOLLOWING],
      ['follow', FOLLOW],
    ] as const) {
      if (
        await header
          .getByRole('button', { name: pattern })
          .filter({ visible: true })
          .first()
          .isVisible()
      )
        return name;
    }
    return null;
  }
  private async ownProfile(page: Page, username: string): Promise<boolean> {
    if (instagramUsername(page.url()) !== username) return false;
    const edit = page
      .locator('main a[href*="/accounts/edit"]')
      .or(page.locator('main').getByRole('button', { name: /^(editar perfil|edit profile)$/i }))
      .first();
    return edit
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
  }
  private async listDialog(
    page: Page,
    context: BrowserContext,
    self: string,
    kind: 'followers' | 'following',
  ): Promise<Locator> {
    await page.goto(`https://www.instagram.com/${self}/`, { waitUntil: 'domcontentloaded' });
    await this.clear(page, context);
    if (!(await this.ownProfile(page, self)))
      throw new Error('Não consegui confirmar que a lista pertence à conta conectada.');
    const link = page
      .locator(`main a[href="/${self}/${kind}/"], main a[href="/${self}/${kind}"]`)
      .first();
    await link.click({ timeout: 10_000 });
    const dialog = page.getByRole('dialog').filter({ visible: true }).first();
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    return dialog;
  }
  private async profileLinks(root: Locator): Promise<string[]> {
    const links = await root
      .locator('a[href]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('href') ?? ''));
    return [
      ...new Set(links.map(instagramUsername).filter((name): name is string => name !== null)),
    ];
  }
  private clear(page: Page, context: BrowserContext): Promise<void> {
    return this.warming.clear('instagram', page, context);
  }
}

async function scrollList(dialog: Locator): Promise<void> {
  await dialog.evaluate((element) => {
    const scroll = [element, ...element.querySelectorAll('*')].find(
      (item) =>
        item.scrollHeight > item.clientHeight + 20 &&
        ['auto', 'scroll'].includes(
          item.ownerDocument.defaultView?.getComputedStyle(item).overflowY ?? '',
        ),
    );
    if (scroll) scroll.scrollTop += Math.max(300, scroll.clientHeight * 0.8);
  });
}
