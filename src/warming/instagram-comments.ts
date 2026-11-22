import type { Locator, Page } from 'playwright-core';
import type { Action } from './warming-state.js';
import { isLiked } from './video-like.js';
import type { ActionTarget } from './warming-browser.js';

const DISABLED =
  /comentários? (?:foram |estão )?desativados|comments (?:are |have been )?(?:turned off|disabled)|não é possível comentar/i;
const LIKE = /^(curtir|like|descurtir|unlike|remover curtida|remove like)$/i;
const REPLY = /^(responder|reply)$/i;

export async function instagramComments(
  page: Page,
  root: Locator,
  url: string,
  action: Action,
  timeoutMs = 20_000,
): Promise<ActionTarget | null> {
  const caption = (await root.innerText()).slice(0, 5000);
  const panel = page.getByRole('dialog').filter({ visible: true }).first();
  if (!(await panel.isVisible())) {
    const open = root
      .getByRole('button', { name: /^(comentar|comment|comments)\b/i })
      .filter({ visible: true })
      .first();
    try {
      await open.waitFor({ state: 'visible', timeout: timeoutMs });
      await open.click({ timeout: timeoutMs });
      await panel.waitFor({ state: 'visible', timeout: timeoutMs });
    } catch {
      throw new Error(
        'Instagram: não consegui abrir o painel de comentários deste vídeo. Nenhum comentário foi enviado.',
      );
    }
  }
  if (DISABLED.test(await panel.innerText())) return null;
  let context = caption;
  if (action === 'commentLikes') {
    const buttons = panel.getByRole('button', { name: LIKE }).filter({ visible: true });
    try {
      await buttons.first().waitFor({ state: 'visible', timeout: timeoutMs });
    } catch {
      return null;
    }
    for (let index = 0; index < (await buttons.count()); index++) {
      const button = buttons.nth(index);
      if (await isLiked(button)) continue;
      const href = await button.evaluate((element) => {
        for (
          let parent = element.parentElement, depth = 0;
          parent && depth < 10;
          parent = parent.parentElement, depth++
        ) {
          const link = parent.querySelector('a[href*="/c/"]');
          if (link) return link.getAttribute('href');
        }
        return null;
      });
      if (href) {
        const row = panel
          .locator(`a[href=${JSON.stringify(href)}]`)
          .first()
          .locator(
            'xpath=ancestor::*[.//*[@aria-label="Curtir" or @aria-label="Descurtir" or @aria-label="Like" or @aria-label="Unlike"]][1]',
          );
        const anchored = row.getByRole('button', { name: LIKE }).first();
        if ((await anchored.count()) > 0)
          return {
            url,
            scope: panel,
            editor: null,
            button: anchored,
            activation: 'keyboard',
            context,
          };
      }
      return { url, scope: panel, editor: null, button, activation: 'keyboard', context };
    }
    return null;
  }
  if (action === 'replies') {
    const reply = panel.getByRole('button', { name: REPLY }).filter({ visible: true }).first();
    try {
      await reply.waitFor({ state: 'visible', timeout: timeoutMs });
    } catch {
      return null;
    }
    const text = await reply.evaluate((element) => {
      for (
        let parent = element.parentElement, depth = 0;
        parent && depth < 10;
        parent = parent.parentElement, depth++
      ) {
        if (parent.querySelector('a[href*="/c/"]')) return parent.textContent;
      }
      return '';
    });
    if (text.trim() === '')
      throw new Error(
        'Instagram: não consegui identificar o comentário a responder. Nenhuma resposta foi enviada.',
      );
    context = `Comentário a responder:\n${text.slice(0, 2000)}\nTexto do vídeo:\n${caption}`;
    await reply.click({ timeout: timeoutMs });
  }
  const editor = panel
    .getByRole('textbox')
    .or(panel.locator('textarea, [contenteditable="true"][role="textbox"]'))
    .filter({ visible: true })
    .first();
  try {
    await editor.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    if (DISABLED.test(await panel.innerText())) return null;
    throw new Error(
      'Instagram: o painel abriu, mas o campo para escrever o comentário não carregou. Nenhum comentário foi enviado.',
    );
  }
  return {
    url,
    scope: panel,
    editor,
    button: null,
    context,
    submit: panel
      .getByRole('button', { name: /^(postar|publicar|enviar|post|send)$/i })
      .filter({ visible: true })
      .first(),
  };
}
