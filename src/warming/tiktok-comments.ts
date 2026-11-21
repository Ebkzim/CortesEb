import type { Locator, Page } from 'playwright-core';
import type { Action } from './warming-state.js';
import type { ActionTarget } from './warming-browser.js';
import { isLiked } from './video-like.js';

const DISABLED =
  /comentários? (?:foram |estão )?desativados|desativou os comentários|comments (?:are |have been )?(?:turned off|disabled)/i;
const EMPTY =
  /nenhum comentário|seja o primeiro a comentar|no comments yet|be the first to comment/i;
const REPLY = /^(responder|reply)$/i;

export async function tiktokComments(
  page: Page,
  root: Locator,
  url: string,
  action: Action,
  verify: () => Promise<void>,
  timeoutMs = 20_000,
): Promise<ActionTarget | null> {
  const editor = page
    .locator(
      '[data-e2e="comment-input"] [contenteditable="true"], [data-e2e="comment-input"] textarea',
    )
    .filter({ visible: true })
    .first();
  const context = (await root.innerText()).slice(0, 6000);
  await verify();
  if (!(await editor.isVisible())) {
    const tab = page
      .getByRole('tab', { name: /^(comentários|comments)\b/i })
      .or(
        page.getByRole('button', {
          name: /^(comentários|comments)\b/i,
        }),
      )
      .filter({ visible: true })
      .first();
    const icon = page.locator('[data-e2e="comment-icon"]').filter({ visible: true }).first();
    const deadline = Date.now() + timeoutMs;
    while (!(await tab.isVisible()) && !(await icon.isVisible()) && Date.now() < deadline) {
      await verify();
      await page.waitForTimeout(250);
    }
    if (await tab.isVisible()) {
      if ((await tab.getAttribute('aria-selected')) !== 'true')
        await tab.click({ timeout: timeoutMs });
    } else if (await icon.isVisible()) await icon.click({ timeout: timeoutMs });
    else throw new Error('TikTok: não encontrei o controle para abrir os comentários deste vídeo.');
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await verify();
    if (await editor.isVisible()) break;
    if (DISABLED.test(await page.locator('body').innerText())) return null;
    await page.waitForTimeout(250);
  }
  await verify();
  if (!(await editor.isVisible()))
    throw new Error(
      'TikTok: selecionei os comentários, mas o editor não carregou. Confira a captura desta etapa; nenhum comentário foi enviado.',
    );
  if (action === 'commentLikes' || action === 'replies') {
    const rows = page
      .locator(
        '[data-e2e="comment-item"], [data-e2e="comment-level-1"], [class*="DivCommentItemContainer"]',
      )
      .filter({ visible: true });
    const end = Date.now() + timeoutMs;
    while ((await rows.count()) === 0 && Date.now() < end) {
      await verify();
      if (EMPTY.test(await page.locator('body').innerText())) return null;
      await page.waitForTimeout(250);
    }
    if ((await rows.count()) === 0)
      throw new Error(
        'TikTok: o painel abriu, mas não consegui identificar os comentários para esta interação.',
      );
    for (let index = 0; index < (await rows.count()); index++) {
      const row = rows.nth(index);
      if (action === 'commentLikes') {
        const button = row
          .locator('[data-e2e="comment-like-icon"], [data-e2e="comment-like"]')
          .or(row.getByRole('button', { name: /^(curtir|like|descurtir|unlike)(?:\b|$)/i }))
          .filter({ visible: true })
          .first();
        if (!(await button.isVisible()) || (await isLiked(button))) continue;
        return { url, scope: row, editor: null, button, context };
      }
      const reply = row
        .getByRole('button', { name: REPLY })
        .or(row.getByText(REPLY, { exact: true }))
        .filter({ visible: true })
        .first();
      if (!(await reply.isVisible())) continue;
      const comment = (await row.innerText()).slice(0, 2000);
      await reply.click({ timeout: timeoutMs });
      await verify();
      return {
        url,
        scope: page.locator('body'),
        editor,
        button: null,
        context: `Comentário a responder:\n${comment}\nTexto do vídeo:\n${context}`,
        submit: page.locator('[data-e2e="comment-post"]').filter({ visible: true }).first(),
      };
    }
    return null;
  }
  return {
    url,
    scope: page.locator('body'),
    editor,
    button: null,
    context,
    submit: page.locator('[data-e2e="comment-post"]').filter({ visible: true }).first(),
  };
}
