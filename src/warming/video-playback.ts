import type { Locator, Page } from 'playwright-core';

const UNAVAILABLE =
  /^(?:vídeo indisponível|video unavailable|video (?:is )?(?:currently )?unavailable|this video (?:is unavailable|isn't available|is not available)|este vídeo não está disponível|este reel não está disponível|this reel (?:is unavailable|isn't available)|this content isn't available right now)[.!]?$/i;

export class VideoUnavailableError extends Error {}

export async function assertVideoAvailable(page: Page): Promise<void> {
  if (await page.getByText(UNAVAILABLE).filter({ visible: true }).first().isVisible()) {
    throw new VideoUnavailableError('O vídeo ficou indisponível na rede. Seguindo para o próximo.');
  }
}

async function snapshot(
  video: Locator,
  start = false,
): Promise<{ time: number; source: string; error: number | null } | null> {
  // evaluateAll returns immediately for a removed element instead of waiting for
  // a locator to match again, potentially against a different video.
  return video.evaluateAll((elements, start) => {
    const video = elements[0] as unknown as
      | {
          muted: boolean;
          play(): Promise<void>;
          currentTime: number;
          currentSrc: string;
          src: string;
          error: { code: number } | null;
        }
      | undefined;
    if (!video) return null;
    if (start) {
      video.muted = true;
      // play() can remain pending while media is loading. Observe playback below
      // without awaiting that promise inside the page.
      void video.play().catch(() => undefined);
    }
    return {
      time: video.currentTime,
      source: video.currentSrc || video.src,
      error: video.error?.code ?? null,
    };
  }, start);
}

export async function watchVideo(
  page: Page,
  video: Locator,
  seconds: number,
  verify: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await verify();
  await assertVideoAvailable(page);
  let previous = await snapshot(video, true);
  if (!previous)
    throw new VideoUnavailableError(
      'O vídeo saiu da página antes da reprodução. Seguindo para o próximo.',
    );
  let advanced = false;
  let remaining = seconds * 1000;
  while (remaining > 0) {
    const delay = Math.min(1000, remaining);
    await page.waitForTimeout(delay);
    signal?.throwIfAborted();
    await verify();
    await assertVideoAvailable(page);
    const current = await snapshot(video);
    if (!current || (previous.source && current.source !== previous.source)) {
      throw new VideoUnavailableError(
        'O vídeo saiu da página ou foi substituído durante a reprodução. Seguindo para o próximo, sem contabilizá-lo.',
      );
    }
    if (current.error !== null)
      throw new Error(
        'O navegador não conseguiu carregar a mídia deste vídeo. Confira a conexão antes de continuar.',
      );
    advanced ||= current.time !== previous.time;
    previous = current;
    remaining -= delay;
  }
  if (!advanced)
    throw new Error(
      'O vídeo não reproduziu durante o tempo configurado. Confira a conexão e a sessão no Chrome.',
    );
}
