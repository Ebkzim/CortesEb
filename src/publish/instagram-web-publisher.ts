import type { Page } from 'playwright-core';
import { captionOf } from './caption.js';
import { BrowserPublisher, visible, type Flow, type PromptRules } from './browser-flow.js';
import type { PublishResult } from './publisher.js';

export const INSTAGRAM_HOME = 'https://www.instagram.com/';

const NEW_POST =
  'svg[aria-label="Novo post"], svg[aria-label="Nova publicação"], svg[aria-label="New post"]';
const CREATE_LINK = /^(criar|create)$/i;
const POST_ITEM = /^(postar|publicação|post)$/i;
const NEXT_BUTTON = /^(avançar|next)$/i;
const SHARE_BUTTON = /^(compartilhar|share)$/i;
const CROP_BUTTON = 'svg[aria-label="Selecionar corte"], svg[aria-label="Select crop"]';
const CAPTION_BOX = [
  'div[role="textbox"][aria-label^="Adicione uma legenda" i]',
  'div[role="textbox"][aria-label^="Escreva uma legenda" i]',
  'div[role="textbox"][aria-label^="Write a caption" i]',
].join(', ');
const DONE_TEXT =
  /(seu reel foi compartilhado|your reel has been shared|reel compartilhado|reel shared|sua publicação foi compartilhada|your post has been shared|publicação compartilhada|post shared)/i;
const PROFILE_LINK = /^(perfil|profile)$/i;

export class InstagramWebPublisher extends BrowserPublisher {
  readonly platform = 'instagram' as const;
  protected readonly prompts: PromptRules = {
    inDialogs: /^(agora não|not now|ok|okay)$/i,
    anywhere: /^(agora não|not now)$/i,
  };

  protected async steps(flow: Flow): Promise<PublishResult> {
    const { page, job, timing } = flow;
    await flow.open(INSTAGRAM_HOME, (url) => url.hostname === 'www.instagram.com');
    const author = await profileName(page);
    await this.openComposer(flow);
    const input = page
      .locator('[role="dialog"] input[type="file"], form input[type="file"]')
      .first();
    await flow.until(timing.editorMs, 'a janela de nova publicação do Instagram', () =>
      input.count().then((n) => n > 0),
    );
    await input.setInputFiles(job.file);
    const next = page.locator('[role="dialog"]').getByRole('button', { name: NEXT_BUTTON }).first();
    await flow.until(timing.editorMs, 'o corte do vídeo no Instagram', () => next.isVisible());
    await this.keepOriginalRatio(page);
    await flow.clickWhenReady(next, 'o botão Avançar do Instagram');
    await page.waitForTimeout(1_500);
    await flow.clickWhenReady(next, 'o botão Avançar do Instagram');
    const caption = page.locator(CAPTION_BOX).first();
    await flow.until(timing.editorMs, 'a legenda do Instagram', () => caption.isVisible());
    await flow.typeInto(caption, captionOf(job), 'Enter');
    await page.keyboard.insertText(' ');
    const share = page
      .locator('[role="dialog"]')
      .getByRole('button', { name: SHARE_BUTTON })
      .first();
    await flow.until(timing.editorMs, 'o botão Compartilhar do Instagram', () => share.isVisible());
    await flow.check();
    flow.posted = true;
    await share.click({ timeout: 15_000 });
    await flow.until(timing.uploadMs, 'a confirmação do Instagram', () =>
      visible(page.getByText(DONE_TEXT)),
    );
    return { url: author === null ? INSTAGRAM_HOME : `${INSTAGRAM_HOME}${author}/reels/` };
  }

  private async openComposer(flow: Flow): Promise<void> {
    const { page, timing } = flow;
    const trigger = page
      .locator(NEW_POST)
      .first()
      .or(page.getByRole('link', { name: CREATE_LINK }).first());
    await flow.until(timing.editorMs, 'o botão Criar do Instagram', () =>
      trigger.first().isVisible(),
    );
    await trigger.first().click({ timeout: 15_000 });
    const item = page
      .getByRole('link', { name: POST_ITEM })
      .or(page.getByRole('menuitem', { name: POST_ITEM }))
      .or(page.getByText(POST_ITEM))
      .first();
    const dialog = page.locator('[role="dialog"] input[type="file"]').first();
    await flow.until(timing.editorMs, 'o menu Criar do Instagram', async () => {
      if ((await dialog.count()) > 0) return true;
      if (await item.isVisible().catch(() => false)) {
        await item.click({ timeout: 5_000 }).catch(() => undefined);
      }
      return (await dialog.count()) > 0;
    });
  }

  private async keepOriginalRatio(page: Page): Promise<void> {
    const crop = page.locator(CROP_BUTTON).first();
    if (!(await crop.isVisible().catch(() => false))) return;
    await crop.click({ timeout: 5_000 }).catch(() => undefined);
    const original = page.getByText(/^original$/i).first();
    if (await original.isVisible().catch(() => false)) {
      await original.click({ timeout: 5_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(400);
  }
}

async function profileName(page: Page): Promise<string | null> {
  const link = page.locator('a[href]').filter({ hasText: PROFILE_LINK }).first();
  const href = await link.getAttribute('href', { timeout: 5_000 }).catch(() => null);
  const match = href === null ? null : /^\/([a-z0-9._]{1,30})\/?$/i.exec(href);
  return match?.[1] ?? null;
}
