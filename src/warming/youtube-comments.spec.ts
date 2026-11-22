import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { chromeCandidates } from '../browser/login-windows.js';
import type { LlmService } from '../llm/llm.service.js';
import type { ApiKeyRepository } from '../database/api-key.repository.js';
import { WarmingBrowser } from './warming-browser.js';
import {
  normalizeComment,
  prepareCommentConfirmation,
  renderedComments,
  waitForCommentConfirmation,
} from './comment-confirmation.js';
import { youtubeComments } from './youtube-comments.js';

const executablePath = chromeCandidates().find((candidate) => fs.existsSync(candidate));
const url = 'https://www.youtube.com/shorts/fixture';
const caption =
  '<style>ytd-comments,ytd-comment-simplebox-renderer,ytd-comment-thread-renderer{display:block;min-height:1px}[contenteditable="true"]{min-height:20px}[hidden]{display:none!important}</style><article id="video">Legenda do vídeo com contexto suficiente para uma interação.</article>';
const verify = (): Promise<void> => Promise.resolve(undefined);

describe.skipIf(executablePath === undefined)('YouTube comment transitions in Chrome', () => {
  let browser: Browser | undefined;
  let page: Page;
  beforeAll(async () => {
    if (!executablePath) throw new Error('Chrome indisponível');
    browser = await chromium.launch({ executablePath, headless: true, timeout: 30_000 });
  }, 45_000);
  beforeEach(async () => {
    if (!browser) throw new Error('O Chrome dos testes não iniciou.');
    page = await browser.newPage();
  });
  afterEach(async () => {
    await page.close();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('waits for the delayed placeholder and activates it exactly once before looking for an editor', async () => {
    await page.setContent(
      `${caption}<ytd-comments><ytd-comments-header-renderer><ytd-comment-simplebox-renderer id="composer"></ytd-comment-simplebox-renderer></ytd-comments-header-renderer></ytd-comments>`,
    );
    await page.locator('#composer').evaluate((composer) => {
      setTimeout(() => {
        const doc = composer.ownerDocument;
        const placeholder = doc.createElement('div');
        placeholder.id = 'placeholder-area';
        placeholder.innerHTML =
          '<yt-formatted-string id="simplebox-placeholder" role="textbox">Add a comment...</yt-formatted-string>';
        placeholder.addEventListener('click', () => {
          composer.setAttribute(
            'data-activations',
            String(Number(composer.getAttribute('data-activations') ?? 0) + 1),
          );
          const editor = doc.createElement('div');
          editor.id = 'contenteditable-root';
          editor.setAttribute('contenteditable', 'true');
          placeholder.replaceWith(editor);
        });
        const button = doc.createElement('button');
        button.textContent = 'Comment';
        composer.append(placeholder, button);
      }, 100);
    });
    const target = await youtubeComments(
      page,
      page.locator('#video'),
      url,
      'comments',
      verify,
      2000,
    );
    expect(await target?.editor?.getAttribute('contenteditable')).toBe('true');
    expect(await page.locator('#composer').getAttribute('data-activations')).toBe('1');
    expect(await target?.submit?.innerText()).toBe('Comment');
  });

  it('waits for the panel to load after the comments button is clicked', async () => {
    await page.setContent(
      `${caption}<button aria-label="935 comments" onclick="this.dataset.clicks=Number(this.dataset.clicks||0)+1;setTimeout(()=>document.querySelector('ytd-comments').hidden=false,100)">Comentários</button><ytd-comments hidden><ytd-comment-simplebox-renderer><div contenteditable="true"></div><button>Comment</button></ytd-comment-simplebox-renderer></ytd-comments>`,
    );
    const target = await youtubeComments(page, page.locator('body'), url, 'comments', verify, 2000);
    expect(target?.editor).not.toBeNull();
    expect(
      await page.getByRole('button', { name: '935 comments' }).getAttribute('data-clicks'),
    ).toBe('1');
  });

  it('selects the visible main composer instead of a hidden copy or another reply editor', async () => {
    await page.setContent(
      `${caption}<ytd-comments hidden><ytd-comment-simplebox-renderer><textarea>Oculto</textarea></ytd-comment-simplebox-renderer></ytd-comments><ytd-comments><ytd-comment-thread-renderer><ytd-comment-simplebox-renderer><textarea>Resposta de outro comentário</textarea><button>Reply</button></ytd-comment-simplebox-renderer></ytd-comment-thread-renderer><ytd-comments-header-renderer><ytd-comment-simplebox-renderer><div id="main" contenteditable="true"></div><button>Comment</button></ytd-comment-simplebox-renderer></ytd-comments-header-renderer></ytd-comments>`,
    );
    const target = await youtubeComments(
      page,
      page.locator('#video'),
      url,
      'comments',
      verify,
      1000,
    );
    expect(await target?.editor?.getAttribute('id')).toBe('main');
    await target?.editor?.fill('Rascunho de teste.');
    expect(await page.locator('textarea').last().inputValue()).toBe('Resposta de outro comentário');
  });

  it.each(['ytd-comment-simplebox-renderer', 'ytd-comment-reply-dialog-renderer'])(
    'uses the selected reply composer and captures that comment as context: %s',
    async (tag) => {
      await page.setContent(
        `${caption}<ytd-comments><ytd-comment-simplebox-renderer><textarea id="main"></textarea><button>Comment</button></ytd-comment-simplebox-renderer><ytd-comment-thread-renderer id="selected"><p id="content-text">O comentário que deve ser respondido.</p><button onclick="this.parentElement.insertAdjacentHTML('beforeend','<${tag}><textarea id=&quot;reply-editor&quot;></textarea><button>Reply</button></${tag}>')">Reply</button></ytd-comment-thread-renderer></ytd-comments>`,
      );
      const target = await youtubeComments(
        page,
        page.locator('#video'),
        url,
        'replies',
        verify,
        1000,
      );
      expect(target?.context).toContain('O comentário que deve ser respondido.');
      expect(await target?.editor?.getAttribute('id')).toBe('reply-editor');
      expect(await target?.submit?.innerText()).toBe('Reply');
      expect(await page.locator('#main').inputValue()).toBe('');
    },
  );

  it('waits for a rendered reply instead of confirming matching text from its parent comment', async () => {
    await page.setContent(
      `${caption}<ytd-comments><ytd-comment-thread-renderer><p id="content-text">Resposta de teste.</p><button onclick="this.parentElement.querySelector('ytd-comment-reply-dialog-renderer').hidden=false">Reply</button><ytd-comment-reply-dialog-renderer hidden><div contenteditable="true"></div><button onclick="const value=this.parentElement.querySelector('[contenteditable]').textContent;const row=this.closest('ytd-comment-thread-renderer');setTimeout(()=>{const replies=document.createElement('ytd-comment-replies-renderer');const p=document.createElement('p');p.id='content-text';p.textContent=value;replies.append(p);row.append(replies);this.parentElement.remove();document.body.dataset.replyConfirmed='true'},100)">Reply</button></ytd-comment-reply-dialog-renderer></ytd-comment-thread-renderer></ytd-comments>`,
    );
    const target = await youtubeComments(
      page,
      page.locator('#video'),
      url,
      'replies',
      verify,
      1000,
    );
    if (!target) throw new Error('compositor ausente');
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'replies',
      'Resposta de teste.',
    );
    expect(await page.locator('body').getAttribute('data-reply-confirmed')).toBe('true');
  });

  it('skips already liked comments and confirms only the next selected comment', async () => {
    await page.setContent(
      `${caption}<ytd-comments><ytd-comment-thread-renderer><div id="like-button"><button aria-label="Like this comment" aria-pressed="true" onclick="this.dataset.wrong='true'">Já curtido</button></div></ytd-comment-thread-renderer><ytd-comment-thread-renderer><div id="like-button"><button aria-label="Like this comment" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true');this.dataset.clicks=Number(this.dataset.clicks||0)+1">Novo</button></div></ytd-comment-thread-renderer></ytd-comments>`,
    );
    const target = await youtubeComments(
      page,
      page.locator('#video'),
      url,
      'commentLikes',
      verify,
      1000,
    );
    if (!target?.button) throw new Error('controle ausente');
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'commentLikes',
      null,
    );
    expect(await target.button.innerText()).toBe('Novo');
    expect(await target.button.getAttribute('data-clicks')).toBe('1');
    expect(await page.locator('[data-wrong]').count()).toBe(0);
  });

  it.each(['replies', 'commentLikes'] as const)(
    'skips %s for an explicitly empty list',
    async (action) => {
      await page.setContent(`${caption}<ytd-comments><p>No comments yet</p></ytd-comments>`);
      expect(
        await youtubeComments(page, page.locator('#video'), url, action, verify, 1000),
      ).toBeNull();
    },
  );
  it('skips comments disabled by the platform', async () => {
    await page.setContent(`${caption}<ytd-comments><p>Comments are turned off.</p></ytd-comments>`);
    expect(
      await youtubeComments(page, page.locator('#video'), url, 'comments', verify, 1000),
    ).toBeNull();
  });
  it('reports a missing composer with its step rather than a raw locator timeout', async () => {
    await page.setContent(`${caption}<ytd-comments></ytd-comments>`);
    await expect(
      youtubeComments(page, page.locator('#video'), url, 'comments', verify, 100),
    ).rejects.toThrow(/YouTube:.*campo de comentário não carregou/);
  });
  it('checks verification while waiting for the composer', async () => {
    await page.setContent(`${caption}<ytd-comments></ytd-comments>`);
    const check = vi
      .fn(() => Promise.resolve(undefined))
      .mockRejectedValueOnce(new Error('Verificação pendente.'));
    await expect(
      youtubeComments(page, page.locator('#video'), url, 'comments', check, 1000),
    ).rejects.toThrow('Verificação pendente.');
  });
  it('confirms the rendered comment after the composer is removed, without counting its draft', async () => {
    await page.setContent(
      `${caption}<ytd-comments><ytd-comment-simplebox-renderer><div contenteditable="true"></div><button onclick="const editor=this.parentElement.querySelector('[contenteditable]');const value=editor.textContent;setTimeout(()=>{const p=document.createElement('p');p.id='content-text';p.textContent=value;this.closest('ytd-comments').append(p);this.parentElement.remove();document.body.dataset.confirmed='true';},100)">Comment</button></ytd-comment-simplebox-renderer></ytd-comments>`,
    );
    const target = await youtubeComments(
      page,
      page.locator('#video'),
      url,
      'comments',
      verify,
      1000,
    );
    if (!target) throw new Error('compositor ausente');
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'comments',
      'Comentário publicado no teste.',
    );
    expect(await page.locator('body').getAttribute('data-confirmed')).toBe('true');
    expect(await page.locator('#content-text').innerText()).toBe('Comentário publicado no teste.');
  });
  it('confirms the actual YouTube emoji-image markup without posting twice', async () => {
    await page.setContent(
      `${caption}<ytd-comments><ytd-comment-simplebox-renderer><div contenteditable="true"></div><button>Comment</button></ytd-comment-simplebox-renderer></ytd-comments>`,
    );
    await page.locator('ytd-comment-simplebox-renderer button').evaluate((button) => {
      button.addEventListener('click', () => {
        const doc = button.ownerDocument;
        const composer = button.parentElement;
        const panel = composer?.parentElement;
        doc.body.setAttribute(
          'data-clicks',
          String(Number(doc.body.getAttribute('data-clicks') ?? 0) + 1),
        );
        const comment = doc.createElement('yt-attributed-string');
        comment.id = 'content-text';
        comment.innerHTML = '<span>@canal&nbsp;Que novidade? <img alt="😔"></span>';
        panel?.append(comment);
        composer?.remove();
      });
    });
    const target = await youtubeComments(
      page,
      page.locator('#video'),
      url,
      'comments',
      verify,
      1000,
    );
    if (!target) throw new Error('compositor ausente');
    await new WarmingBrowser({} as LlmService, {} as ApiKeyRepository).perform(
      page,
      target,
      'comments',
      '@canal Que novidade? 😔',
    );
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
    expect(await renderedComments(page.locator('#content-text'))).toEqual([
      '@canal Que novidade? 😔',
    ]);
    expect(await page.getByText('@canal Que novidade? 😔', { exact: true }).count()).toBe(0);
  });

  it('does not count an identical existing comment, even if YouTube recreates its nodes', async () => {
    await page.setContent(
      `${caption}<div contenteditable="true" id="editor"></div><section id="list"><p id="content-text">Já existe 😔</p></section>`,
    );
    const candidates = page.locator('#content-text');
    const receipt = await prepareCommentConfirmation(
      candidates,
      page.locator('#editor'),
      'Já existe 😔',
    );
    expect(await receipt.confirmed()).toBe(false);
    await page.locator('#list').evaluate((list) => {
      list.innerHTML = '<p id="content-text">Já existe <img alt="😔"></p>';
    });
    expect(await receipt.confirmed()).toBe(false);
    await page.locator('#list').evaluate((list) => {
      list.insertAdjacentHTML('beforeend', '<p id="content-text">Já existe <img alt="😔"></p>');
    });
    expect(await receipt.confirmed()).toBe(true);
  });

  it('requires a new rendered match and a cleared editor instead of counting the draft', async () => {
    await page.setContent(
      `${caption}<div contenteditable="true" id="editor">Teste</div><section id="list"></section>`,
    );
    const receipt = await prepareCommentConfirmation(
      page.locator('#content-text, [contenteditable]'),
      page.locator('#editor'),
      'Teste',
    );
    expect(await receipt.confirmed()).toBe(false);
    await page.locator('#list').evaluate((list) => {
      list.innerHTML = '<p id="content-text">Teste</p>';
    });
    expect(await receipt.confirmed()).toBe(false);
    await page.locator('#editor').fill('');
    expect(await receipt.confirmed()).toBe(true);
  });

  it('does not treat an empty editor or a different comment as publication proof', async () => {
    await page.setContent(
      `${caption}<div contenteditable="true" id="editor"></div><p id="content-text">Outro comentário</p>`,
    );
    const receipt = await prepareCommentConfirmation(
      page.locator('#content-text'),
      page.locator('#editor'),
      'Texto esperado',
    );
    await expect(waitForCommentConfirmation(page, receipt, 100)).rejects.toThrow(
      /YouTube não confirmou/,
    );
  });

  it('normalizes whitespace, accents, invisible separators and emoji presentation without removing emoji joiners', () => {
    expect(normalizeComment('  cafe\u0301\u200b\u00a0\n❤️  ')).toBe('café ❤');
    expect(normalizeComment('Família 👩‍👩‍👦')).toBe('Família 👩‍👩‍👦');
  });
});
