import { randomUUID } from 'node:crypto';
import type { Locator, Page } from 'playwright-core';
import type { BrowserPlatform } from '../browser/browser-sessions.js';
import { SITES } from '../browser/sites.js';

const LIKE =
  /^(curtir(?: vídeo)?|like(?: video)?|descurtir|remover curtida|unlike|remove like)(?:\b|$)/i;
const YOUTUBE_LIKE =
  /^(curtir(?: vídeo)?|like(?: video)?|descurtir|remover curtida|unlike|remove like|gostei|i like this|marcar(?: este vídeo)? como ["“]?gostei|remover (?:a )?marcação ["“]?gostei|remover (?:o )?gostei|desmarcar ["“]?gostei)(?:\b|$)/i;
const YOUTUBE_SLOT = 'like-button-view-model, yt-like-button-view-model, #like-button';

async function likeState(button: Locator): Promise<boolean | null> {
  return button.evaluateAll((elements) => {
    const element = elements[0];
    if (!element) return null;
    const pressed =
      element.getAttribute('aria-pressed') ??
      element.querySelector('[aria-pressed]')?.getAttribute('aria-pressed');
    if (pressed === 'true') return true;
    if (pressed === 'false') return false;
    if (element.getAttribute('data-state') === 'liked') return true;
    const unlike =
      /^(descurtir|remover curtida|unlike|remove like|remover (?:a )?marcação ["“]?gostei|remover (?:o )?gostei|desmarcar ["“]?gostei)/i;
    if (
      [element, ...element.querySelectorAll('[aria-label]')].some((item) =>
        unlike.test(item.getAttribute('aria-label') ?? ''),
      )
    )
      return true;
    const red = /rgb\(\s*254,\s*44,\s*85\s*\)|#fe2c55/i;
    return [...element.querySelectorAll('svg, svg path')].some((icon) => {
      const style = icon.ownerDocument.defaultView?.getComputedStyle(icon);
      return (
        red.test(style?.fill ?? '') ||
        red.test(style?.color ?? '') ||
        red.test(icon.getAttribute('fill') ?? '')
      );
    });
  });
}

export async function isLiked(button: Locator): Promise<boolean> {
  return (await likeState(button)) === true;
}

async function anchorVideoLike(
  page: Page,
  button: Locator,
  platform: BrowserPlatform,
  timeoutMs: number,
): Promise<Locator> {
  const token = randomUUID();
  const slot = await button.evaluate(
    (element, { token, youtube, selector }) => {
      const container = youtube ? element.closest(selector) : null;
      const wrapper = container !== null && container !== element;
      (wrapper ? container : element).setAttribute('data-cortes-like-target', token);
      return wrapper;
    },
    { token, youtube: platform === 'youtube', selector: YOUTUBE_SLOT },
    { timeout: timeoutMs },
  );
  const anchored = page.locator(`[data-cortes-like-target="${token}"]`);
  return slot ? anchored.getByRole('button').filter({ visible: true }).first() : anchored;
}

export async function findVideoLike(
  page: Page,
  platform: BrowserPlatform,
  scope: Locator,
  timeoutMs = 20_000,
): Promise<Locator | null> {
  const candidates =
    platform === 'tiktok'
      ? scope.locator('[data-e2e="like-icon"], [data-key-interaction="action_like"]').or(
          scope.getByRole('button', {
            name: /^(curtir vídeo|like video|descurtir vídeo|unlike video)(?:\b|$)/i,
          }),
        )
      : platform === 'youtube'
        ? scope
            .locator(
              'like-button-view-model button, yt-like-button-view-model button, #like-button button, button#like-button, #like-button[role="button"]',
            )
            .or(scope.getByRole('button', { name: YOUTUBE_LIKE }))
        : scope.getByRole('button', { name: LIKE });
  const button = candidates.filter({ visible: true }).first();
  try {
    await button.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch (error) {
    if (page.isClosed()) throw error;
    throw new Error(
      `Não encontrei o botão de curtir deste vídeo no ${SITES[platform].label} após aguardar os controles carregarem.`,
    );
  }
  const anchored = await anchorVideoLike(page, button, platform, timeoutMs);
  return (await isLiked(anchored)) ? null : anchored;
}

export async function clickLike(
  page: Page,
  button: Locator,
  timeoutMs = 10_000,
  activation: 'click' | 'keyboard' = 'click',
): Promise<void> {
  const initial = await likeState(button);
  if (initial === true) return;
  if (initial === null)
    throw new Error(
      'O botão de curtir deixou de estar disponível antes do envio. Confira o vídeo antes de continuar.',
    );
  if (activation === 'keyboard') await button.press('Enter', { timeout: timeoutMs });
  else await button.click({ timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  do {
    if ((await likeState(button)) === true) return;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  throw new Error(
    'A curtida não foi confirmada pela página. Confira a rede; a tentativa não será repetida automaticamente.',
  );
}
