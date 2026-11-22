import { randomUUID } from 'node:crypto';
import type { Locator, Page } from 'playwright-core';
import type { Action } from './warming-state.js';
import type { ActionTarget } from './warming-browser.js';
import { findVideoLike } from './video-like.js';

const PANEL = 'ytd-engagement-panel-section-list-renderer[target-id*="comment"], ytd-comments';
const THREAD = 'ytd-comment-thread-renderer, yt-comment-thread-view-model';
const COMPOSER = 'ytd-comment-simplebox-renderer, yt-comment-simplebox-view-model';
const EDITOR = 'textarea:not([readonly]), [contenteditable="true"]';
const DISABLED =
  /^(?:(?:os )?comentários? (?:foram |estão )?desativados|comments (?:are |have been )?(?:turned off|disabled))/i;
const EMPTY =
  /^(?:nenhum comentário|seja o primeiro a comentar|no comments yet|be the first to comment)/i;
const LIKE =
  /^(curtir|like|descurtir|unlike|gostei|remover (?:o )?gostei|remover curtida|remove like)(?:\b|$)/i;
const REPLY = /^(responder|reply)$/i;
const POST = /^(comentar|publicar|postar|enviar|responder|comment|post|send|reply)$/i;

async function poll<T>(
  page: Page,
  verify: () => Promise<void>,
  timeoutMs: number,
  read: () => Promise<T | null>,
): Promise<T | null> {
  let deadline = Date.now() + timeoutMs;
  do {
    const before = Date.now();
    await verify();
    deadline += Date.now() - before;
    const result = await read();
    if (result !== null) return result;
    await page.waitForTimeout(Math.min(250, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  return null;
}
async function disabled(scope: Locator): Promise<boolean> {
  return scope.getByText(DISABLED).filter({ visible: true }).first().isVisible();
}
async function text(scope: Locator, max: number): Promise<string> {
  return scope.evaluateAll((items, max) => (items[0]?.textContent ?? '').trim().slice(0, max), max);
}

export async function youtubeComments(
  page: Page,
  root: Locator,
  url: string,
  action: Action,
  verify: () => Promise<void>,
  timeoutMs = 20_000,
): Promise<ActionTarget | null> {
  const caption = await text(root, 6500);
  const panel = page.locator(PANEL).filter({ visible: true }).first();
  const open = root
    .getByRole('button', { name: /comentários|comments/i })
    .filter({ visible: true })
    .first();
  let opened = false;
  const panelReady = await poll(page, verify, timeoutMs, async () => {
    if (await panel.isVisible()) return 'ready';
    if (await disabled(root)) return 'disabled';
    if (!opened && (await open.isVisible())) {
      opened = true;
      try {
        await open.click({ timeout: Math.min(5000, timeoutMs) });
      } catch {
        throw new Error(
          'YouTube: não consegui abrir o painel de comentários. Nenhuma interação foi enviada.',
        );
      }
    }
    return null;
  });
  if (panelReady === 'disabled' || (await disabled(panel))) return null;
  if (panelReady === null)
    throw new Error(
      'YouTube: o painel de comentários não carregou. Nenhuma interação foi enviada.',
    );

  let scope = panel;
  let context = caption;
  if (action === 'replies' || action === 'commentLikes') {
    const rows = panel.locator(THREAD).filter({ visible: true });
    const ready = await poll(page, verify, timeoutMs, async () => {
      if (
        (await disabled(panel)) ||
        (await panel.getByText(EMPTY).filter({ visible: true }).first().isVisible())
      )
        return 'empty';
      return (await rows.count()) > 0 ? 'ready' : null;
    });
    if (ready === 'empty') return null;
    if (!ready)
      throw new Error(
        'YouTube: o painel abriu, mas a lista de comentários não carregou. Nenhuma interação foi enviada.',
      );
    for (let i = 0; i < Math.min(await rows.count(), 10); i++) {
      const row = rows.nth(i);
      if (action === 'commentLikes') {
        if (
          !(await row
            .getByRole('button', { name: LIKE })
            .filter({ visible: true })
            .first()
            .isVisible())
        )
          continue;
        const button = await findVideoLike(page, 'youtube', row, Math.min(3000, timeoutMs));
        if (button)
          return { url, scope: row, editor: null, button, context: await text(row, 2000) };
        continue;
      }
      const reply = row.getByRole('button', { name: REPLY }).filter({ visible: true }).first();
      if (!(await reply.isVisible())) continue;
      const token = randomUUID();
      await row.evaluate(
        (element, token) => {
          element.setAttribute('data-cortes-comment-target', token);
        },
        token,
        { timeout: timeoutMs },
      );
      scope = page.locator(`[data-cortes-comment-target="${token}"]`);
      const comment =
        (await text(scope.locator('#content-text').first(), 2000)) || (await text(scope, 2000));
      if (!comment)
        throw new Error(
          'YouTube: não consegui identificar o comentário a responder. Nenhuma resposta foi enviada.',
        );
      context = `Comentário a responder:\n${comment}\nTexto do vídeo:\n${caption}`;
      try {
        await scope
          .getByRole('button', { name: REPLY })
          .filter({ visible: true })
          .first()
          .click({ timeout: Math.min(5000, timeoutMs) });
      } catch {
        throw new Error(
          'YouTube: não consegui abrir o campo de resposta do comentário selecionado. Nenhuma resposta foi enviada.',
        );
      }
      break;
    }
    if (scope === panel) return null;
  }

  const composer =
    action === 'replies'
      ? scope
          .locator(`ytd-comment-reply-dialog-renderer, ${COMPOSER}`)
          .filter({ visible: true })
          .first()
      : panel.locator(`:is(${COMPOSER}):not(:is(${THREAD}) *)`).filter({ visible: true }).first();
  const editor = composer.locator(EDITOR).filter({ visible: true }).first();
  const placeholder = composer
    .locator('#simplebox-placeholder, #placeholder-area')
    .filter({ visible: true })
    .first();
  let activated = false;
  const editorReady = await poll(page, verify, timeoutMs, async () => {
    if (await disabled(panel)) return 'disabled';
    if (await editor.isVisible()) return 'ready';
    if (!activated && (await placeholder.isVisible())) {
      activated = true;
      try {
        await placeholder.click({ timeout: Math.min(5000, timeoutMs) });
      } catch {
        throw new Error(
          'YouTube: não consegui ativar o campo para escrever. Nenhum comentário foi enviado.',
        );
      }
    }
    return null;
  });
  if (editorReady === 'disabled') return null;
  if (!editorReady)
    throw new Error(
      `YouTube: o painel abriu, mas o campo de ${action === 'replies' ? 'resposta' : 'comentário'} não carregou após a ativação. Nenhum texto foi enviado.`,
    );
  return {
    url,
    scope,
    editor,
    button: null,
    context,
    submit: composer.getByRole('button', { name: POST }).filter({ visible: true }).first(),
    confirmation: scope.locator(
      action === 'replies'
        ? 'ytd-comment-replies-renderer #content-text, yt-comment-replies-view-model #content-text'
        : '#content-text',
    ),
  };
}
