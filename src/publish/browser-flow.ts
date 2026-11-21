import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from 'playwright-core';
import { AppError } from '../common/app-error.js';
import type { BrowserPlatform, BrowserSessions } from '../browser/browser-sessions.js';
import { SITES, type SiteSession } from '../browser/sites.js';
import type { Job } from '../contracts/publish.js';
import { PublishError, type Publisher, type PublishResult } from './publisher.js';

export interface FlowTiming {
  editorMs: number;
  uploadMs: number;
  confirmMs: number;
  stepMs: number;
}

export const FLOW_TIMING: FlowTiming = {
  editorMs: 3 * 60_000,
  uploadMs: 15 * 60_000,
  confirmMs: 3 * 60_000,
  stepMs: 1_000,
};

export interface PromptRules {
  inDialogs: RegExp | null;
  anywhere: RegExp | null;
  texts?: RegExp;
}

const DIALOGS = '[role="dialog"], [class*="modal" i]';

export class Flow {
  posted = false;

  constructor(
    readonly page: Page,
    readonly context: BrowserContext,
    readonly job: Job,
    readonly timing: FlowTiming,
    private readonly platform: BrowserPlatform,
    private readonly session: SiteSession,
    private readonly prompts: PromptRules,
  ) {}

  check(): Promise<void> {
    return this.session.ensureClear(this.platform, this.page, this.context, this.job.account);
  }

  tidy(): Promise<number> {
    return dismissPrompts(this.page, this.prompts);
  }

  async open(url: string, expected: (current: URL) => boolean): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await this.check();
    if (!expected(new URL(this.page.url()))) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await this.check();
    }
  }

  async until(timeoutMs: number, what: string, ready: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.tidy();
      if (await ready().catch(() => false)) return;
      await this.check();
      await this.page.waitForTimeout(this.timing.stepMs);
    }
    throw new Error(`${what} não respondeu a tempo`);
  }

  async clickWhenReady(
    button: Locator,
    what: string,
    timeoutMs = this.timing.editorMs,
  ): Promise<void> {
    await this.until(timeoutMs, what, () => isEnabled(button));
    await button.click({ timeout: 15_000 });
  }

  async typeInto(editor: Locator, text: string, newline: string): Promise<void> {
    await editor.click({ timeout: 15_000 });
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.press('Backspace');
    for (const [index, line] of text.split('\n').entries()) {
      if (index > 0) await this.page.keyboard.press(newline);
      if (line !== '') await this.page.keyboard.insertText(line);
    }
    await this.page.waitForTimeout(400);
  }
}

export abstract class BrowserPublisher implements Publisher {
  abstract readonly platform: BrowserPlatform;
  protected abstract readonly prompts: PromptRules;

  constructor(
    protected readonly sessions: BrowserSessions,
    protected readonly session: SiteSession,
    protected readonly debugDir: string,
    protected readonly timing: FlowTiming = FLOW_TIMING,
  ) {}

  protected abstract steps(flow: Flow): Promise<PublishResult>;

  async publish(job: Job): Promise<PublishResult> {
    if ((await fs.stat(job.file).catch(() => null)) === null) {
      throw new PublishError('o vídeo não existe mais', false);
    }
    try {
      return await this.sessions.with(this.platform, job.account, (page, context) =>
        this.run(
          new Flow(page, context, job, this.timing, this.platform, this.session, this.prompts),
        ),
      );
    } catch (error) {
      if (error instanceof PublishError) throw error;
      const final = error instanceof AppError && error.code === 'MISSING_DEPENDENCY';
      throw new PublishError(
        error instanceof Error ? error.message : `erro no ${SITES[this.platform].label}`,
        !final,
      );
    }
  }

  private async run(flow: Flow): Promise<PublishResult> {
    try {
      return await this.steps(flow);
    } catch (error) {
      const shot = await this.snapshot(flow.page);
      const hint = shot === null ? '' : ` (tela salva em ${shot})`;
      if (flow.posted) {
        throw new PublishError(
          `o ${SITES[this.platform].label} não confirmou a postagem; confira o perfil antes de tentar de novo${hint}`,
          false,
        );
      }
      throw new PublishError(`${firstLine(error).slice(0, 300)}${hint}`, true);
    }
  }

  private async snapshot(page: Page): Promise<string | null> {
    try {
      await fs.mkdir(this.debugDir, { recursive: true, mode: 0o700 });
      const file = path.join(this.debugDir, `${this.platform}-ultimo-erro.png`);
      await page.screenshot({ path: file, fullPage: false, timeout: 10_000 });
      await fs.chmod(file, 0o600);
      return file;
    } catch {
      return null;
    }
  }
}

export function firstLine(error: unknown): string {
  return error instanceof Error ? (error.message.split('\n')[0] ?? 'erro') : 'erro';
}

export async function isEnabled(button: Locator): Promise<boolean> {
  if (!(await button.isVisible())) return false;
  if (!(await button.isEnabled())) return false;
  const aria = await button.getAttribute('aria-disabled');
  const loading = await button.getAttribute('data-loading');
  return aria !== 'true' && loading !== 'true';
}

export async function visible(locator: Locator): Promise<boolean> {
  return locator
    .first()
    .isVisible()
    .catch(() => false);
}

export async function dismissPrompts(page: Page, rules: PromptRules): Promise<number> {
  let closed = 0;
  if (rules.inDialogs !== null) {
    const dialogs = page.locator(DIALOGS);
    const count = Math.min(await dialogs.count().catch(() => 0), 6);
    for (let index = 0; index < count; index += 1) {
      const dialog = dialogs.nth(index);
      if (!(await dialog.isVisible().catch(() => false))) continue;
      const button = dialog.getByRole('button', { name: rules.inDialogs }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 5_000 }).catch(() => undefined);
        closed += 1;
      }
    }
  }
  if (rules.anywhere !== null) {
    const buttons = page.getByRole('button', { name: rules.anywhere });
    const count = Math.min(await buttons.count().catch(() => 0), 6);
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 5_000 }).catch(() => undefined);
        closed += 1;
      }
    }
  }
  if (rules.texts !== undefined) {
    const item = page.getByText(rules.texts).first();
    if (await item.isVisible().catch(() => false)) {
      await item.click({ timeout: 5_000 }).catch(() => undefined);
      closed += 1;
    }
  }
  if (closed > 0) await page.waitForTimeout(400);
  return closed;
}
