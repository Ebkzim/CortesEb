import type { Page } from 'playwright-core';
import type { BrowserSessions } from '../browser/browser-sessions.js';
import type { SiteSession } from '../browser/sites.js';
import { captionOf } from './caption.js';
import {
  BrowserPublisher,
  FLOW_TIMING,
  visible,
  type Flow,
  type FlowTiming,
  type PromptRules,
} from './browser-flow.js';
import type { PublishResult } from './publisher.js';

export const YOUTUBE_UPLOAD = 'https://www.youtube.com/upload';
export const YOUTUBE_STUDIO = 'https://studio.youtube.com/';
export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

const RADIO: Record<Visibility, string> = {
  public: 'PUBLIC',
  unlisted: 'UNLISTED',
  private: 'PRIVATE',
};
const NOT_FOR_KIDS = 'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]';
const UPLOADING = /(enviando|uploading|carregando|carregado|enviado\s+\d|upload em andamento)/i;
const DONE_TEXT =
  /(vídeo publicado|video published|vídeo salvo|video saved|vídeo programado|video scheduled|shorts publicado)/i;
const VIDEO_LINK = /(?:youtu\.be\/|\/shorts\/|watch\?v=)([A-Za-z0-9_-]{6,20})/;

export function youtubeText(text: string, limit: number): string {
  return text.replace(/[<>]/g, '').slice(0, limit).trim();
}

export function shortsUrl(href: string | null): string | null {
  const match = href === null ? null : VIDEO_LINK.exec(href);
  return match?.[1] === undefined ? null : `https://www.youtube.com/shorts/${match[1]}`;
}

export class YoutubeWebPublisher extends BrowserPublisher {
  readonly platform = 'youtube' as const;
  protected readonly prompts: PromptRules = {
    inDialogs: null,
    anywhere: /^(agora não|not now|dispensar|dismiss|entendi|got it)$/i,
  };

  constructor(
    sessions: BrowserSessions,
    session: SiteSession,
    debugDir: string,
    private readonly visibility: Visibility = 'public',
    timing: FlowTiming = FLOW_TIMING,
  ) {
    super(sessions, session, debugDir, timing);
  }

  protected async steps(flow: Flow): Promise<PublishResult> {
    const { page, job, timing } = flow;
    await flow.open(YOUTUBE_UPLOAD, (url) => url.hostname === 'studio.youtube.com');
    const input = page.locator('input[type="file"]').first();
    await flow.until(timing.editorMs, 'a janela de envio do YouTube Studio', () =>
      input.count().then((n) => n > 0),
    );
    await input.setInputFiles(job.file);
    const title = page.locator('#title-textarea #textbox').first();
    await flow.until(timing.editorMs, 'os detalhes do vídeo no YouTube', () => title.isVisible());
    await page.waitForTimeout(1_500);
    await flow.typeInto(title, youtubeText(job.title, 100), 'Shift+Enter');
    const description = page.locator('#description-textarea #textbox').first();
    await flow.typeInto(description, youtubeText(captionOf(job), 5000), 'Enter');
    const link = await this.videoLink(page);
    const kids = page.locator(NOT_FOR_KIDS).first();
    await kids.scrollIntoViewIfNeeded({ timeout: 15_000 });
    await kids.click({ timeout: 15_000 });
    const next = page.locator('#next-button').first();
    const radio = page
      .locator(`tp-yt-paper-radio-button[name="${RADIO[this.visibility]}"]`)
      .first();
    for (let step = 0; step < 4 && !(await radio.isVisible().catch(() => false)); step += 1) {
      await flow.clickWhenReady(next, 'o botão Próximo do YouTube');
      await page.waitForTimeout(1_200);
    }
    await flow.until(timing.editorMs, 'a etapa de visibilidade do YouTube', () =>
      radio.isVisible(),
    );
    await radio.click({ timeout: 15_000 });
    await flow.until(timing.uploadMs, 'o envio do vídeo ao YouTube', () => this.uploaded(page));
    const done = page.locator('#done-button').first();
    await flow.check();
    flow.posted = true;
    await flow.clickWhenReady(done, 'o botão Publicar do YouTube');
    await flow.until(timing.confirmMs, 'a confirmação do YouTube', async () => {
      if (await visible(page.locator('ytcp-video-share-dialog'))) return true;
      return visible(page.getByText(DONE_TEXT));
    });
    return { url: link ?? shortsUrl(await this.videoLink(page)) ?? YOUTUBE_STUDIO };
  }

  private async videoLink(page: Page): Promise<string | null> {
    const anchor = page
      .locator('ytcp-video-info a[href], a[href*="youtu.be/"], a[href*="/shorts/"]')
      .first();
    const href = await anchor.getAttribute('href', { timeout: 10_000 }).catch(() => null);
    return shortsUrl(href);
  }

  private async uploaded(page: Page): Promise<boolean> {
    const label = page
      .locator('ytcp-video-upload-progress .progress-label, ytcp-video-upload-progress')
      .first();
    const text = (await label.innerText({ timeout: 5_000 }).catch(() => '')).trim();
    return text !== '' && !UPLOADING.test(text);
  }
}
