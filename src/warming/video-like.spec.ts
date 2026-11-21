import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { chromeCandidates } from '../browser/login-windows.js';
import type { LlmService } from '../llm/llm.service.js';
import type { ApiKeyRepository } from '../database/api-key.repository.js';
import { warmingConfigSchema, emptyCounts } from './warming-state.js';
import type { WarmingSession } from './warming-state.js';
import { tiktokComments } from './tiktok-comments.js';
import { instagramComments } from './instagram-comments.js';
import { WarmingDesk } from './warming-desk.js';
import { WarmingBrowser, activeVideo, clickNextVideo } from './warming-browser.js';
import { clickLike, findVideoLike } from './video-like.js';
import { VideoUnavailableError, watchVideo } from './video-playback.js';

const executablePath = chromeCandidates().find((candidate) => fs.existsSync(candidate));

// These DOM regressions run against Chrome when available, without a platform login or network.
describe.skipIf(executablePath === undefined)('video like controls in Chrome', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    if (executablePath === undefined) throw new Error('Chrome indisponível');
    browser = await chromium.launch({ executablePath, headless: true });
  });
  beforeEach(async () => {
    page = await browser.newPage();
  });
  afterEach(async () => {
    await page.close();
  });
  afterAll(async () => {
    await browser.close();
  });

  it('skips the unavailable-video screen without waiting for a missing video locator', async () => {
    await page.setContent('<h2>Vídeo indisponível</h2>');
    await expect(
      watchVideo(page, page.locator('video'), 10, () => Promise.resolve(undefined)),
    ).rejects.toBeInstanceOf(VideoUnavailableError);
  });

  it.each(['<h2>Vídeo indisponível</h2>', '<div>Player atualizado</div>'])(
    'detects a video disappearing during playback: %s',
    async (replacement) => {
      await page.setContent('<video style="width:200px;height:200px"></video>');
      const video = await activeVideo(page);
      let checks = 0;
      await expect(
        watchVideo(page, video, 0.05, async () => {
          if (++checks === 2) await page.setContent(replacement);
        }),
      ).rejects.toBeInstanceOf(VideoUnavailableError);
    },
  );

  it('does not wait forever on a pending media play promise', async () => {
    await page.setContent(
      '<video></video><script>document.querySelector("video").play = () => new Promise(() => {});</script>',
    );
    await expect(
      watchVideo(page, page.locator('video'), 0.05, () => Promise.resolve(undefined)),
    ).rejects.toThrow(/não reproduziu/);
  });

  it('keeps the selected video stable if another video is inserted before it', async () => {
    await page.setContent(
      '<video id="selected" style="width:200px;height:200px"></video><script>document.querySelector("video").play = () => Promise.resolve();</script>',
    );
    const video = await activeVideo(page);
    await page.locator('body').evaluate((body) => {
      body.insertAdjacentHTML('afterbegin', '<video id="different"></video>');
    });
    expect(await video.getAttribute('id')).toBe('selected');
  });

  it('accepts a looping video that returns to the initial timestamp after making progress', async () => {
    await page.setContent(
      '<video></video><script>const video=document.querySelector("video");const times=[0,5,0];Object.defineProperty(video,"currentTime",{get:()=>times.shift()??0});video.play=()=>Promise.resolve();</script>',
    );
    await expect(
      watchVideo(page, page.locator('video'), 1.01, () => Promise.resolve(undefined)),
    ).resolves.toBeUndefined();
  });

  it('waits for the TikTok control to appear after the video', async () => {
    await page.setContent(`<video style="width:200px;height:200px"></video><script>
      setTimeout(() => { document.body.insertAdjacentHTML('beforeend', '<div role="button" data-e2e="like-icon" aria-label="Curtir vídeo" aria-pressed="false">Curtida</div>'); }, 300);
    </script>`);
    const button = await findVideoLike(page, 'tiktok', page.locator('body'));
    expect(await button?.getAttribute('data-e2e')).toBe('like-icon');
  });

  it('ignores a hidden copy before the visible TikTok control', async () => {
    await page.setContent(
      '<div data-e2e="like-icon" aria-pressed="true" hidden>Oculto</div><div role="button" data-e2e="like-icon" aria-pressed="false">Visível</div>',
    );
    const button = await findVideoLike(page, 'tiktok', page.locator('body'));
    expect(await button?.innerText()).toBe('Visível');
  });

  it('recognizes the accessible TikTok control when the data attribute is absent', async () => {
    await page.setContent(
      '<button aria-label="Curtir vídeo&#10;123 curtidas" aria-pressed="false">123</button>',
    );
    expect(await findVideoLike(page, 'tiktok', page.locator('body'))).not.toBeNull();
  });

  it('does not mistake a comment-like control for the TikTok video control', async () => {
    await page.setContent(
      '<button aria-label="Curtir comentário" aria-pressed="false">Comentário</button>',
    );
    await expect(findVideoLike(page, 'tiktok', page.locator('body'), 50)).rejects.toThrow(/TikTok/);
  });

  it('skips an already liked video even with a like label', async () => {
    await page.setContent(
      '<button data-e2e="like-icon" aria-label="Curtir vídeo" aria-pressed="true">Curtida</button>',
    );
    expect(await findVideoLike(page, 'tiktok', page.locator('body'))).toBeNull();
  });

  it('clicks only once while waiting for a delayed confirmation', async () => {
    await page.setContent(
      `<button data-e2e="like-icon" aria-pressed="false" onclick="this.dataset.clicks = Number(this.dataset.clicks || 0) + 1; setTimeout(() => this.setAttribute('aria-pressed', 'true'), 350)">Curtir</button>`,
    );
    const button = await findVideoLike(page, 'tiktok', page.locator('body'));
    if (button === null) throw new Error('controle ausente');
    await clickLike(page, button);
    expect(await button.getAttribute('data-clicks')).toBe('1');
    expect(await button.getAttribute('aria-pressed')).toBe('true');
  });

  it('does not toggle a like added after the control was prepared', async () => {
    await page.setContent(
      '<button data-e2e="like-icon" aria-pressed="false" onclick="this.dataset.clicked = true">Curtir</button>',
    );
    const button = await findVideoLike(page, 'tiktok', page.locator('body'));
    if (button === null) throw new Error('controle ausente');
    await button.evaluate((element) => {
      element.setAttribute('aria-pressed', 'true');
    });
    await clickLike(page, button);
    expect(await button.getAttribute('data-clicked')).toBeNull();
  });

  it('keeps the watched page loaded after TikTok canonicalizes the account handle', async () => {
    let navigations = 0;
    await page.route('https://www.tiktok.com/**', async (route) => {
      navigations += 1;
      await route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<video style="width:200px;height:200px"></video><div role="button" data-e2e="like-icon" aria-pressed="false">Curtir</div><script>history.replaceState(null, "", "/@canonical/video/123")</script>',
      });
    });
    const adapter = new WarmingBrowser({} as LlmService, {} as ApiKeyRepository);
    const url = 'https://www.tiktok.com/@canal/video/123';
    await adapter.prepare(page, 'tiktok', url, 'views');
    expect(page.url()).toBe('https://www.tiktok.com/@canonical/video/123');
    const target = await adapter.prepare(page, 'tiktok', url, 'likes');
    expect(navigations).toBe(1);
    expect(target?.button).not.toBeNull();
  });
  it('discovers a TikTok video exposed only through its player and author', async () => {
    await page
      .context()
      .addCookies([{ name: 'sessionid', value: 'fixture', domain: '.tiktok.com', path: '/' }]);
    await page.route('https://www.tiktok.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<main><article><div id="xgwrapper-0-7709508922041748737"><video style="width:200px;height:200px"></video></div></article><a href="/@canal">Canal</a></main>',
      }),
    );
    const adapter = new WarmingBrowser({} as LlmService, {} as ApiKeyRepository);
    const session = {
      platform: 'tiktok',
      seen: [],
      config: warmingConfigSchema.parse({}),
      counts: emptyCounts(),
    } as unknown as WarmingSession;
    expect(await adapter.next(page, session)).toBe(
      'https://www.tiktok.com/@canal/video/7709508922041748737',
    );
  });

  it.each(['economy', 'standard'] as const)(
    'uses the %s search profile when opening a TikTok feed video',
    async (searchMode) => {
      let navigations = 0;
      await page.route('https://www.tiktok.com/**', async (route) => {
        navigations++;
        await route.fulfill({
          contentType: 'text/html',
          body: '<main><article><div id="xgwrapper-0-7709508922041748737"><video style="width:200px;height:200px"></video></div><button data-e2e="like-icon" aria-pressed="false">Curtir</button></article></main>',
        });
      });
      await page.goto('https://www.tiktok.com/foryou');
      const adapter = new WarmingBrowser({} as LlmService, {} as ApiKeyRepository);
      const target = await adapter.prepare(
        page,
        'tiktok',
        'https://www.tiktok.com/@canal/video/7709508922041748737',
        'views',
        searchMode,
      );
      expect(target?.video).toBeDefined();
      expect(navigations).toBe(searchMode === 'economy' ? 1 : 2);
      expect(page.url()).toBe(
        searchMode === 'economy'
          ? 'https://www.tiktok.com/foryou'
          : 'https://www.tiktok.com/@canal/video/7709508922041748737',
      );
      const like = await adapter.prepare(
        page,
        'tiktok',
        'https://www.tiktok.com/@canal/video/7709508922041748737',
        'likes',
        searchMode,
      );
      expect(like?.button).not.toBeNull();
      expect(navigations).toBe(2);
      expect(page.url()).toContain('/video/7709508922041748737');
    },
  );

  it('does not reuse a partial TikTok feed video when a different video is active', async () => {
    let navigations = 0;
    await page.route('https://www.tiktok.com/**', async (route) => {
      navigations++;
      const body =
        navigations === 1
          ? '<div id="xgwrapper-0-7709508922041748737"><video style="width:20px;height:20px"></video></div><div id="xgwrapper-0-7709508922041748738"><video style="width:200px;height:200px"></video></div>'
          : '<div id="xgwrapper-0-7709508922041748737"><video style="width:200px;height:200px"></video></div>';
      await route.fulfill({ contentType: 'text/html', body });
    });
    await page.goto('https://www.tiktok.com/foryou');
    const adapter = new WarmingBrowser({} as LlmService, {} as ApiKeyRepository);
    await adapter.prepare(
      page,
      'tiktok',
      'https://www.tiktok.com/@canal/video/7709508922041748737',
      'views',
      'economy',
    );
    expect(navigations).toBe(2);
    expect(page.url()).toContain('/video/7709508922041748737');
  });

  it('recognizes the plural reels URL used by the Instagram feed', async () => {
    await page
      .context()
      .addCookies([{ name: 'sessionid', value: 'fixture', domain: '.instagram.com', path: '/' }]);
    await page.route('https://www.instagram.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<script>history.replaceState(null,"","/reels/ABC123/")</script><video style="width:200px;height:200px"></video>',
      }),
    );
    const adapter = new WarmingBrowser({} as LlmService, {} as ApiKeyRepository);
    const session = {
      platform: 'instagram',
      seen: [],
      config: warmingConfigSchema.parse({}),
      counts: emptyCounts(),
    } as unknown as WarmingSession;
    expect(await adapter.next(page, session)).toBe('https://www.instagram.com/reel/ABC123');
  });

  it.each(['views', 'skipped'])(
    'advances TikTok past a %s video despite a changed handle',
    async (prefix) => {
      await page
        .context()
        .addCookies([{ name: 'sessionid', value: 'fixture', domain: '.tiktok.com', path: '/' }]);
      await page.route('https://www.tiktok.com/**', (route) =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<main><div id="xgwrapper-0-7709508922041748737"><video style="width:200px;height:200px"></video></div><a href="/@canonical">Canal</a><button aria-label="Ir para o próximo vídeo" onclick="document.querySelector('[id]').id='xgwrapper-0-7709508922041748738'">Próximo</button></main>`,
        }),
      );
      const adapter = new WarmingBrowser({} as LlmService, {} as ApiKeyRepository);
      const session = {
        platform: 'tiktok',
        seen: [`${prefix}:https://www.tiktok.com/@123/video/7709508922041748737`],
        config: warmingConfigSchema.parse({}),
        counts: emptyCounts(),
      } as unknown as WarmingSession;
      expect(await adapter.next(page, session)).toBe(
        'https://www.tiktok.com/@canonical/video/7709508922041748738',
      );
    },
    10_000,
  );
  it('opens the Instagram comment drawer and supports its input composer', async () => {
    await page.setContent(
      `<p>Uma legenda suficientemente longa para contextualizar o comentário.</p><button aria-label="Comentar" onclick="document.querySelector('[role=dialog]').hidden=false">Comentários</button><div role="dialog" hidden><input placeholder="Adicione um comentário..."><button onclick="this.dataset.clicked='true'">Postar</button></div>`,
    );
    const target = await instagramComments(
      page,
      page.locator('body'),
      'https://www.instagram.com/reel/fixture',
      'comments',
    );
    expect(await target?.editor?.getAttribute('placeholder')).toBe('Adicione um comentário...');
    expect(await target?.submit?.getAttribute('data-clicked')).toBeNull();
    expect(await page.getByRole('dialog').isVisible()).toBe(true);
    await target?.editor?.fill('Rascunho não enviado.');
    await page
      .getByRole('dialog')
      .locator('input')
      .evaluate((element) => {
        element.removeAttribute('placeholder');
      });
    expect(await target?.editor?.inputValue()).toBe('Rascunho não enviado.');
    await target?.editor?.fill('');
  });

  it('confirms a comment sent through the scoped Instagram composer', async () => {
    await page.setContent(
      `<button onclick="this.dataset.wrong='true'">Postar</button><div role="dialog"><p>Legenda do vídeo para contextualizar uma interação relevante.</p><input placeholder="Adicione um comentário..."><button onclick="const p=document.createElement('p');const input=this.parentElement.querySelector('input');p.textContent=input.value;this.parentElement.append(p);input.value='';this.dataset.sent='true'">Postar</button><button>Responder</button></div>`,
    );
    const target = await instagramComments(
      page,
      page.locator('body'),
      'https://www.instagram.com/reel/fixture',
      'comments',
    );
    if (!target) throw new Error('compositor ausente');
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'comments',
      'Uma resposta de teste.',
    );
    expect(await target.submit?.getAttribute('data-sent')).toBe('true');
    expect(await page.locator('[data-wrong]').count()).toBe(0);
  });

  it('skips comments explicitly disabled by the author', async () => {
    await page.setContent('<div role="dialog">Os comentários foram desativados.</div>');
    expect(
      await instagramComments(
        page,
        page.locator('body'),
        'https://www.instagram.com/reel/fixture',
        'comments',
      ),
    ).toBeNull();
  });

  it('finds comment likes in the Instagram drawer without legacy lists', async () => {
    await page.setContent(
      '<div role="dialog"><p>Um comentário interessante.</p><button>Responder</button><button aria-label="Curtir">Curtir</button><input placeholder="Adicione um comentário..."></div>',
    );
    const target = await instagramComments(
      page,
      page.locator('body'),
      'https://www.instagram.com/reel/fixture',
      'commentLikes',
    );
    expect(await target?.button?.getAttribute('aria-label')).toBe('Curtir');
  });

  it('reports a missing Instagram composer with an actionable message', async () => {
    await page.setContent('<div role="dialog">Comentários carregados, mas sem editor.</div>');
    await expect(
      instagramComments(
        page,
        page.locator('body'),
        'https://www.instagram.com/reel/fixture',
        'comments',
        30,
      ),
    ).rejects.toThrow(/campo para escrever o comentário não carregou/);
  });
  it('supports Instagram switching its input into a contenteditable textbox', async () => {
    await page.setContent(
      `<div role="dialog"><p>Legenda para contextualizar a interação.</p><input placeholder="Adicione um comentário..."><button onclick="const editor=this.parentElement.querySelector('[role=textbox]');const p=document.createElement('p');p.textContent=editor.textContent;editor.textContent='';this.parentElement.append(p)">Postar</button></div>`,
    );
    const target = await instagramComments(
      page,
      page.locator('body'),
      'https://www.instagram.com/reel/fixture',
      'comments',
    );
    if (!target?.editor) throw new Error('compositor ausente');
    await page
      .getByRole('dialog')
      .locator('input')
      .evaluate((input) => {
        const editor = input.ownerDocument.createElement('div');
        editor.setAttribute('role', 'textbox');
        editor.setAttribute('contenteditable', 'true');
        input.replaceWith(editor);
      });
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'comments',
      'Um comentário de teste.',
    );
    expect(await target.editor.innerText()).toBe('');
    expect(await target.scope.getByText('Um comentário de teste.', { exact: true }).count()).toBe(
      1,
    );
  });
  it('confirms an Instagram comment like without jumping to the next unliked comment', async () => {
    await page.setContent(
      `<div role="dialog"><div><p>Primeiro comentário</p><button aria-label="Curtir" onclick="this.setAttribute('aria-label','Descurtir');this.dataset.clicks=Number(this.dataset.clicks||0)+1">Primeiro</button></div><div><p>Segundo comentário</p><button aria-label="Curtir" onclick="this.dataset.clicked='true'">Segundo</button></div></div>`,
    );
    const target = await instagramComments(
      page,
      page.locator('body'),
      'https://www.instagram.com/reel/fixture',
      'commentLikes',
    );
    if (!target?.button) throw new Error('controle ausente');
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'commentLikes',
      null,
    );
    expect(await target.button.getAttribute('aria-label')).toBe('Descurtir');
    expect(await target.button.getAttribute('data-clicks')).toBe('1');
    expect(await page.locator('[data-clicked]').count()).toBe(0);
  });

  it('skips existing comment likes without removing them', async () => {
    await page.setContent(
      '<div role="dialog"><button aria-label="Descurtir">Já curtido</button><button aria-label="Curtir">Novo</button></div>',
    );
    const target = await instagramComments(
      page,
      page.locator('body'),
      'https://www.instagram.com/reel/fixture',
      'commentLikes',
    );
    expect(await target?.button?.innerText()).toBe('Novo');
  });
  it('tracks the same comment if Instagram reorders comments after liking', async () => {
    await page.setContent(
      `<div role="dialog"><article><a href="/p/fixture/c/111/">Data</a><button aria-label="Curtir" onclick="this.setAttribute('aria-label','Descurtir');this.parentElement.parentElement.append(this.parentElement)"><svg aria-label="Curtir"></svg></button></article><article><a href="/p/fixture/c/222/">Data</a><button aria-label="Curtir"><svg aria-label="Curtir"></svg></button></article></div>`,
    );
    const target = await instagramComments(
      page,
      page.locator('body'),
      'https://www.instagram.com/reel/fixture',
      'commentLikes',
    );
    if (!target?.button) throw new Error('controle ausente');
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'commentLikes',
      null,
    );
    expect(await target.button.getAttribute('aria-label')).toBe('Descurtir');
  });
  it('selects TikTok comments instead of waiting inside the recommendations tab', async () => {
    await page.setContent(
      `<p>Uma legenda com contexto suficiente para comentar.</p><button role="tab" aria-selected="false" onclick="this.setAttribute('aria-selected','true');document.querySelector('[data-e2e=comment-input]').hidden=false">Comentários</button><button role="tab" aria-selected="true">Você pode gostar</button><div data-e2e="comment-input" hidden><div contenteditable="true" role="textbox"></div><button data-e2e="comment-post">Publicar</button></div>`,
    );
    const target = await tiktokComments(
      page,
      page.locator('body'),
      'https://www.tiktok.com/@canal/video/123',
      'comments',
      () => Promise.resolve(),
    );
    expect(await target?.editor?.isVisible()).toBe(true);
    expect(
      await page
        .getByRole('tab', { name: 'Comentários', exact: true })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('opens the TikTok comment icon when the sidebar tab is not present', async () => {
    await page.setContent(
      `<p>Uma legenda com contexto suficiente para comentar.</p><button data-e2e="comment-icon" onclick="document.querySelector('[data-e2e=comment-input]').hidden=false">Comentários do vídeo</button><div data-e2e="comment-input" hidden><div contenteditable="true" role="textbox"></div><button data-e2e="comment-post" onclick="const e=this.parentElement.querySelector('[role=textbox]');const p=document.createElement('p');p.textContent=e.textContent;document.body.append(p);e.textContent=''">Publicar</button></div>`,
    );
    const target = await tiktokComments(
      page,
      page.locator('body'),
      'https://www.tiktok.com/@canal/video/123',
      'comments',
      () => Promise.resolve(),
    );
    if (!target) throw new Error('editor ausente');
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'comments',
      'Comentário de teste.',
    );
    expect(await target.editor?.innerText()).toBe('');
    expect(await page.getByText('Comentário de teste.', { exact: true }).count()).toBe(1);
  });

  it('surfaces TikTok verification while comments are loading instead of a locator timeout', async () => {
    await page.setContent('<button role="tab">Comentários</button>');
    let checks = 0;
    const verify = (): Promise<void> => {
      checks++;
      return checks > 1
        ? Promise.reject(new Error('TikTok pediu uma verificação'))
        : Promise.resolve();
    };
    await expect(
      tiktokComments(
        page,
        page.locator('body'),
        'https://www.tiktok.com/@canal/video/123',
        'comments',
        verify,
      ),
    ).rejects.toThrow('TikTok pediu uma verificação');
  });

  it('skips TikTok videos with comments disabled', async () => {
    await page.setContent(
      '<button role="tab" aria-selected="true">Comentários</button><p>O criador desativou os comentários.</p>',
    );
    expect(
      await tiktokComments(
        page,
        page.locator('body'),
        'https://www.tiktok.com/@canal/video/123',
        'comments',
        () => Promise.resolve(),
      ),
    ).toBeNull();
  });

  it('prepares a TikTok comment like using its stable data attribute', async () => {
    await page.setContent(
      `<div data-e2e="comment-input"><div role="textbox" contenteditable="true"></div></div><div data-e2e="comment-item"><p>Comentário a curtir</p><button data-e2e="comment-like-icon" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">Curtir</button></div>`,
    );
    const target = await tiktokComments(
      page,
      page.locator('body'),
      'https://www.tiktok.com/@canal/video/123',
      'commentLikes',
      () => Promise.resolve(),
    );
    if (!target?.button) throw new Error('controle ausente');
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'commentLikes',
      null,
    );
    expect(await target.button.getAttribute('aria-pressed')).toBe('true');
  });
  it('activates Instagram comment hearts through their keyboard handler', async () => {
    await page.setContent(
      `<div role="dialog"><article><a href="/p/fixture/c/123/">Data</a><div role="button" tabindex="0" onclick="this.dataset.mouse='true'" onkeydown="if(event.key==='Enter'){this.querySelector('svg').setAttribute('aria-label','Descurtir');this.dataset.keys=Number(this.dataset.keys||0)+1}"><svg aria-label="Curtir" width="16" height="16"><title>Curtir</title></svg></div></article></div>`,
    );
    const target = await instagramComments(
      page,
      page.locator('body'),
      'https://www.instagram.com/reel/fixture',
      'commentLikes',
    );
    if (!target?.button) throw new Error('controle ausente');
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'commentLikes',
      null,
    );
    expect(await target.button.getAttribute('data-keys')).toBe('1');
    expect(await target.button.getAttribute('data-mouse')).toBeNull();
    expect(await target.button.locator('svg').getAttribute('aria-label')).toBe('Descurtir');
  });
  it('keeps the original page available while a human verification is pending', async () => {
    await page
      .context()
      .addCookies([{ name: 'sessionid', value: 'fixture', domain: '.tiktok.com', path: '/' }]);
    await page.setContent('<div id="captcha-fixture">Verificação de teste</div>');
    const desk = new WarmingDesk();
    desk.useNotifier(() => undefined);
    const adapter = new WarmingBrowser({} as LlmService, {} as ApiKeyRepository, desk);
    const stages: boolean[] = [];
    adapter.observeVerification(page, 'canal', (waiting) => {
      stages.push(waiting);
      return Promise.resolve();
    });
    const request = adapter.clear('tiktok', page, page.context());
    await expect.poll(() => desk.state()).not.toBeNull();
    expect(desk.state()?.account).toBe('canal');
    expect(page.isClosed()).toBe(false);
    expect((await desk.frame()).byteLength).toBeGreaterThan(0);
    // Only the fixture is changed here; real verification is performed by the operator.
    await page.locator('#captcha-fixture').evaluate((element) => {
      element.remove();
    });
    await request;
    expect(stages).toEqual([true, false]);
    expect(desk.state()).toBeNull();
    expect(page.isClosed()).toBe(false);
  }, 10_000);

  it('cancels a pending verification on stop without leaving a browser request behind', async () => {
    await page
      .context()
      .addCookies([{ name: 'sessionid', value: 'fixture', domain: '.tiktok.com', path: '/' }]);
    await page.setContent('<div id="captcha-fixture">Verificação de teste</div>');
    const desk = new WarmingDesk();
    desk.useNotifier(() => undefined);
    const adapter = new WarmingBrowser({} as LlmService, {} as ApiKeyRepository, desk);
    const abort = new AbortController();
    adapter.observeVerification(page, 'canal', () => Promise.resolve(), abort.signal);
    const request = adapter.clear('tiktok', page, page.context());
    const rejected = expect(request).rejects.toThrow(/cancelada ou expirou/);
    await expect.poll(() => desk.state()).not.toBeNull();
    abort.abort();
    await rejected;
    expect(desk.state()).toBeNull();
  });

  it('checks for a verification when next-video navigation times out', async () => {
    await page.setContent('<button disabled>Próximo vídeo</button>');
    let checked = 0;
    await expect(
      clickNextVideo(
        page.getByRole('button'),
        () => {
          checked++;
          return Promise.reject(new Error('Verificação pendente na página original'));
        },
        30,
      ),
    ).rejects.toThrow(/Verificação pendente/);
    expect(checked).toBe(1);
  });

  it('returns a recoverable navigation result instead of exposing a raw click timeout', async () => {
    await page.setContent('<button disabled>Próximo vídeo</button>');
    expect(await clickNextVideo(page.getByRole('button'), () => Promise.resolve(), 30)).toBe(false);
  });
  it('pauses playing media during verification and resumes only previously playing media', async () => {
    await page.setContent(
      '<video id="playing"></video><video id="paused"></video><div role="dialog"><video id="manual-media"></video></div>',
    );
    await page.locator('video').evaluateAll((elements) => {
      for (const element of elements) {
        element.setAttribute(
          'data-paused',
          element.id === 'playing' || element.id === 'manual-media' ? 'false' : 'true',
        );
        Object.defineProperty(element, 'paused', {
          get: () => element.getAttribute('data-paused') === 'true',
        });
        Object.defineProperty(element, 'pause', {
          value: () => {
            element.setAttribute('data-paused', 'true');
          },
        });
        Object.defineProperty(element, 'play', {
          value: () => {
            element.setAttribute('data-resumed', 'true');
            element.setAttribute('data-paused', 'false');
            return Promise.resolve();
          },
        });
      }
    });
    const desk = new WarmingDesk();
    desk.useNotifier(() => undefined);
    let finished = false;
    const request = desk.request(page, {
      reason: 'verify',
      account: 'canal',
      platform: 'tiktok',
      message: 'Teste manual',
      timeoutMs: 5000,
      pollMs: 20,
      mode: 'browser',
      solved: () => Promise.resolve(finished),
    });
    await expect.poll(() => desk.state()).not.toBeNull();
    expect(desk.state()?.mode).toBe('browser');
    expect(await page.locator('#playing').getAttribute('data-paused')).toBe('true');
    expect(await page.locator('#manual-media').getAttribute('data-paused')).toBe('false');
    finished = true;
    await request;
    expect(await page.locator('#playing').getAttribute('data-resumed')).toBe('true');
    expect(await page.locator('#paused').getAttribute('data-resumed')).toBeNull();
  });

  it('ends manual verification when the original Chrome page is closed', async () => {
    const desk = new WarmingDesk();
    desk.useNotifier(() => undefined);
    const request = desk.request(page, {
      reason: 'verify',
      account: 'canal',
      platform: 'tiktok',
      message: 'Teste manual',
      timeoutMs: 5000,
      pollMs: 20,
      mode: 'browser',
      solved: () => Promise.resolve(false),
    });
    await expect.poll(() => desk.state()).not.toBeNull();
    await page.close();
    expect(await request).toBe(false);
    expect(desk.state()).toBeNull();
  });
});
