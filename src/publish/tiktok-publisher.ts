import type { Locator } from 'playwright-core';
import { captionOf } from './caption.js';
import {
  BrowserPublisher,
  isEnabled,
  visible,
  type Flow,
  type PromptRules,
} from './browser-flow.js';
import type { PublishResult } from './publisher.js';

export const TIKTOK_UPLOAD = 'https://www.tiktok.com/tiktokstudio/upload?from=webapp';
export const TIKTOK_CONTENT = 'https://www.tiktok.com/tiktokstudio/content';

const POST_BUTTON = /^(post|publicar|postar)$/i;
const CONFIRM_BUTTON = /^(post now|publicar agora|postar agora|continuar|continue)$/i;
const DONE_TEXT =
  /(video (has been )?(posted|published)|vídeo (foi )?(publicado|postado)|enviado com sucesso)/i;

export class TikTokPublisher extends BrowserPublisher {
  readonly platform = 'tiktok' as const;
  protected readonly prompts: PromptRules = {
    inDialogs: /^(cancelar|cancel|agora não|not now|depois|mais tarde|later)$/i,
    anywhere: /^(entendi|got it|ok|okay)$/i,
  };

  protected async steps(flow: Flow): Promise<PublishResult> {
    const { page, job, timing } = flow;
    await flow.open(TIKTOK_UPLOAD, (url) => url.pathname.includes('/upload'));
    const input = page.locator('input[type="file"]').first();
    await flow.until(timing.editorMs, 'a página de upload do TikTok', () =>
      input.count().then((n) => n > 0),
    );
    await input.setInputFiles(job.file);
    const editor = page.locator('[contenteditable="true"]').first();
    await flow.until(timing.editorMs, 'o editor do TikTok', () => editor.isVisible());
    await this.writeCaption(flow, editor, captionOf(job));
    const post = page
      .locator('button[data-e2e="post_video_button"]')
      .or(page.getByRole('button', { name: POST_BUTTON }))
      .first();
    await flow.until(timing.uploadMs, 'o envio do vídeo ao TikTok', () => isEnabled(post));
    await flow.check();
    await flow.tidy();
    flow.posted = true;
    await post.click({ timeout: 15_000 });
    await this.confirm(flow);
    return { url: TIKTOK_CONTENT };
  }

  private async writeCaption(flow: Flow, editor: Locator, caption: string): Promise<void> {
    const { page } = flow;
    await flow.tidy();
    await editor.click({ timeout: 15_000 });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    for (const [index, line] of caption.split('\n').entries()) {
      if (index > 0) await page.keyboard.press('Shift+Enter');
      for (const word of line.split(/(\s+)/)) {
        if (word === '') continue;
        await page.keyboard.insertText(word);
        if (word.startsWith('#')) {
          await page.waitForTimeout(600);
          await page.keyboard.press('Escape').catch(() => undefined);
        }
      }
    }
    await page.waitForTimeout(500);
  }

  private async confirm(flow: Flow): Promise<void> {
    const { page, timing } = flow;
    const deadline = Date.now() + timing.confirmMs;
    const confirm = page.getByRole('button', { name: CONFIRM_BUTTON }).first();
    while (Date.now() < deadline) {
      if (page.url().includes('/tiktokstudio/content')) return;
      if (await visible(page.getByText(DONE_TEXT))) return;
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click().catch(() => undefined);
      }
      await flow.check();
      await page.waitForTimeout(timing.stepMs);
    }
    throw new Error('sem confirmação');
  }
}
