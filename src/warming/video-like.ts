import type { Locator, Page } from 'playwright-core';
import type { BrowserPlatform } from '../browser/browser-sessions.js';
import { SITES } from '../browser/sites.js';

const LIKE =
  /^(curtir(?: vídeo)?|like(?: video)?|descurtir|remover curtida|unlike|remove like)(?:\b|$)/i;
const UNLIKE = /^(descurtir|remover curtida|unlike|remove like)/i;

export async function redLike(button: Locator): Promise<boolean> {
  return button.locator('svg, svg path').evaluateAll((icons) =>
    icons.some((icon) => {
      const style = icon.ownerDocument.defaultView?.getComputedStyle(icon);
      const red = /rgb\(\s*254,\s*44,\s*85\s*\)|#fe2c55/i;
      return (
        red.test(style?.fill ?? '') ||
        red.test(style?.color ?? '') ||
        red.test(icon.getAttribute('fill') ?? '')
      );
    }),
  );
}

export async function isLiked(button: Locator): Promise<boolean> {
  const pressed = await button.getAttribute('aria-pressed');
  // Explicit state takes precedence over styling, which may also color an inactive icon.
  if (pressed === 'true') return true;
  if (pressed === 'false') return false;
  if ((await button.getAttribute('data-state')) === 'liked') return true;
  if (UNLIKE.test((await button.getAttribute('aria-label')) ?? '')) return true;
  const nestedUnlike = await button
    .locator('[aria-label]')
    .evaluateAll((elements) =>
      elements.some((element) =>
        /^(descurtir|remover curtida|unlike|remove like)/i.test(
          element.getAttribute('aria-label') ?? '',
        ),
      ),
    );
  return nestedUnlike || (await redLike(button));
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
      : scope.getByRole('button', { name: LIKE });
  // Re-evaluate visibility as hydration completes. The first DOM match can be a hidden copy.
  const button = candidates.filter({ visible: true }).first();
  try {
    await button.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch (error) {
    if (page.isClosed()) throw error;
    throw new Error(
      `Não encontrei o botão de curtir deste vídeo no ${SITES[platform].label} após aguardar os controles carregarem.`,
    );
  }
  return (await isLiked(button)) ? null : button;
}

export async function clickLike(
  page: Page,
  button: Locator,
  timeoutMs = 10_000,
  activation: 'click' | 'keyboard' = 'click',
): Promise<void> {
  // The page may have updated since preparation; never toggle a like that is already present.
  if (await isLiked(button)) return;
  if (activation === 'keyboard') await button.press('Enter', { timeout: timeoutMs });
  else await button.click({ timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  do {
    if (await isLiked(button)) return;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  throw new Error(
    'A curtida não foi confirmada pela página. Confira a rede; a tentativa não será repetida automaticamente.',
  );
}
