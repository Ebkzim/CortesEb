import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from 'playwright-core';
import { AppError } from '../common/app-error.js';
import type { Job, Platform } from '../contracts/publish.js';
import type { BrowserSessions } from '../browser/browser-sessions.js';
import { TIKTOK_CONTENT, TIKTOK_UPLOAD, type TikTokSession } from '../browser/tiktok.js';
import { captionOf } from './caption.js';
import { PublishError, type Publisher, type PublishResult } from './publisher.js';

export interface TikTokTiming {
  editorMs: number;
  uploadMs: number;
  confirmMs: number;
  stepMs: number;
}

export const TIKTOK_TIMING: TikTokTiming = {
  editorMs: 3 * 60_000,
  uploadMs: 15 * 60_000,
  confirmMs: 3 * 60_000,
  stepMs: 1_000,
};

const POST_BUTTON = /^(post|publicar|postar)$/i;
const CONFIRM_BUTTON = /^(post now|publicar agora|postar agora|continuar|continue)$/i;
const DONE_TEXT =
  /(video (has been )?(posted|published)|vídeo (foi )?(publicado|postado)|enviado com sucesso)/i;
const DISMISS_BUTTON = /^(cancelar|cancel|agora não|not now|depois|mais tarde|later)$/i;
const DIALOGS = '[role="dialog"], [class*="modal" i]';
const ACKNOWLEDGE_BUTTON = /^(entendi|got it|ok|okay)$/i;
const UNCERTAIN = 'o TikTok não confirmou a postagem; confira o perfil antes de tentar de novo';

export class TikTokPublisher implements Publisher {
  readonly platform: Platform = 'tiktok';

  constructor(
    private readonly sessions: BrowserSessions,
    private readonly session: TikTokSession,
    private readonly debugDir: string,
    private readonly timing: TikTokTiming = TIKTOK_TIMING,
  ) {}

  async publish(job: Job): Promise<PublishResult> {
    if ((await fs.stat(job.file).catch(() => null)) === null) {
      throw new PublishError('o vídeo não existe mais', false);
    }
    try {
      return await this.sessions.with('tiktok', job.account, (page, context) =>
        this.upload(page, context, job),
      );
    } catch (error) {
      if (error instanceof PublishError) throw error;
      const final = error instanceof AppError && error.code === 'MISSING_DEPENDENCY';
      throw new PublishError(error instanceof Error ? error.message : 'erro no TikTok', !final);
    }
  }

  private async upload(page: Page, context: BrowserContext, job: Job): Promise<PublishResult> {
    let posted = false;
    try {
      await page.goto(TIKTOK_UPLOAD, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await this.session.ensureClear(page, context, job.account);
      if (!page.url().includes('/upload')) {
        await page.goto(TIKTOK_UPLOAD, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      }
      const input = page.locator('input[type="file"]').first();
      await this.until(page, context, job, this.timing.editorMs, async () =>
        input.count().then((n) => n > 0),
      );
      await input.setInputFiles(job.file);
      const editor = page.locator('[contenteditable="true"]').first();
      await this.until(page, context, job, this.timing.editorMs, () => editor.isVisible());
      await this.writeCaption(page, editor, captionOf(job));
      const post = this.postButton(page);
      await this.until(page, context, job, this.timing.uploadMs, () => isEnabled(post));
      await this.session.ensureClear(page, context, job.account);
      await dismissPrompts(page);
      posted = true;
      await post.click({ timeout: 15_000 });
      await this.confirm(page, context, job);
      return { url: TIKTOK_CONTENT };
    } catch (error) {
      const shot = await this.snapshot(page);
      const hint = shot === null ? '' : ` (tela salva em ${shot})`;
      if (posted) throw new PublishError(`${UNCERTAIN}${hint}`, false);
      const message = error instanceof Error ? (error.message.split('\n')[0] ?? 'erro') : 'erro';
      throw new PublishError(`${message.slice(0, 300)}${hint}`, true);
    }
  }

  private async writeCaption(page: Page, editor: Locator, caption: string): Promise<void> {
    await dismissPrompts(page);
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

  private postButton(page: Page): Locator {
    return page
      .locator('button[data-e2e="post_video_button"]')
      .or(page.getByRole('button', { name: POST_BUTTON }))
      .first();
  }

  private async confirm(page: Page, context: BrowserContext, job: Job): Promise<void> {
    const deadline = Date.now() + this.timing.confirmMs;
    const confirm = page.getByRole('button', { name: CONFIRM_BUTTON }).first();
    while (Date.now() < deadline) {
      if (page.url().includes('/tiktokstudio/content')) return;
      if (
        await page
          .getByText(DONE_TEXT)
          .first()
          .isVisible()
          .catch(() => false)
      )
        return;
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click().catch(() => undefined);
      }
      await this.session.ensureClear(page, context, job.account);
      await page.waitForTimeout(this.timing.stepMs);
    }
    throw new Error('sem confirmação');
  }

  private async until(
    page: Page,
    context: BrowserContext,
    job: Job,
    timeoutMs: number,
    ready: () => Promise<boolean>,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await dismissPrompts(page);
      if (await ready().catch(() => false)) return;
      await this.session.ensureClear(page, context, job.account);
      await page.waitForTimeout(this.timing.stepMs);
    }
    throw new Error('a página de upload do TikTok não respondeu a tempo');
  }

  private async snapshot(page: Page): Promise<string | null> {
    try {
      await fs.mkdir(this.debugDir, { recursive: true, mode: 0o700 });
      const file = path.join(this.debugDir, 'tiktok-ultimo-erro.png');
      await page.screenshot({ path: file, fullPage: false, timeout: 10_000 });
      await fs.chmod(file, 0o600);
      return file;
    } catch {
      return null;
    }
  }
}

async function isEnabled(button: Locator): Promise<boolean> {
  if (!(await button.isVisible())) return false;
  if (!(await button.isEnabled())) return false;
  const aria = await button.getAttribute('aria-disabled');
  const loading = await button.getAttribute('data-loading');
  return aria !== 'true' && loading !== 'true';
}

export async function dismissPrompts(page: Page): Promise<number> {
  const dialogs = page.locator(DIALOGS);
  const count = Math.min(await dialogs.count().catch(() => 0), 6);
  let closed = 0;
  for (let index = 0; index < count; index += 1) {
    const dialog = dialogs.nth(index);
    if (!(await dialog.isVisible().catch(() => false))) continue;
    const button = dialog.getByRole('button', { name: DISMISS_BUTTON }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 5_000 }).catch(() => undefined);
      closed += 1;
    }
  }
  const acknowledge = page.getByRole('button', { name: ACKNOWLEDGE_BUTTON });
  const notes = Math.min(await acknowledge.count().catch(() => 0), 6);
  for (let index = 0; index < notes; index += 1) {
    const button = acknowledge.nth(index);
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 5_000 }).catch(() => undefined);
      closed += 1;
    }
  }
  if (closed > 0) await page.waitForTimeout(400);
  return closed;
}
