import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright-core';
import { RemoteDesk, type HumanRequest } from '../browser/remote-desk.js';

@Injectable()
export class WarmingDesk extends RemoteDesk {
  override frame(): Promise<Buffer> {
    return super.frame(40);
  }

  override async request(page: Page, request: HumanRequest): Promise<boolean> {
    if (request.signal?.aborted) return false;
    // Pause media only; the verification itself remains entirely human-controlled.
    await page.locator('video, audio').evaluateAll((media) => {
      for (const element of media) {
        if (element.closest('[role="dialog"], [id*="captcha" i], [class*="captcha" i]')) continue;
        const player = element as unknown as { paused: boolean; pause(): void };
        if (!player.paused) {
          element.setAttribute('data-cortes-resume-media', 'true');
          player.pause();
        }
      }
    });
    const closed = (): void => {
      this.cancel();
    };
    page.on('close', closed);
    let solved = false;
    try {
      solved = await super.request(page, request);
      return solved;
    } finally {
      page.off('close', closed);
      if (!page.isClosed()) {
        await page
          .locator('[data-cortes-resume-media]')
          .evaluateAll((media, resume) => {
            for (const element of media) {
              element.removeAttribute('data-cortes-resume-media');
              if (resume)
                void (element as unknown as { play(): Promise<void> })
                  .play()
                  .catch(() => undefined);
            }
          }, solved)
          .catch(() => undefined);
      }
    }
  }
}
