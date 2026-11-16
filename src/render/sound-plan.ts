import type { RenderSound } from '../contracts/render.js';
import type { SfxName } from '../sfx/sfx-library.js';
import type { PlacedShot } from '../timeline/spans.js';

export type StagedSounds = Partial<Record<SfxName, string>>;

const IMPACT_VOLUME = 0.5;
const ACCENT_VOLUME = 0.45;
const WHOOSH_LEAD = 0.08;
const POP_LEAD = 0.05;

export function planSounds(
  placed: readonly PlacedShot[],
  imageTimes: readonly number[],
  staged: StagedSounds,
  gain: number,
): RenderSound[] {
  const sounds: RenderSound[] = [];
  if (staged.impact !== undefined) {
    sounds.push({ file: staged.impact, at: 0, volume: IMPACT_VOLUME * gain });
  }
  if (staged.whoosh !== undefined) {
    for (const shot of placed) {
      if (!shot.turn) continue;
      sounds.push({
        file: staged.whoosh,
        at: Math.max(0, shot.outStart - WHOOSH_LEAD),
        volume: ACCENT_VOLUME * gain,
      });
    }
  }
  if (staged.pop !== undefined) {
    for (const time of imageTimes) {
      sounds.push({
        file: staged.pop,
        at: Math.max(0, time - POP_LEAD),
        volume: ACCENT_VOLUME * gain,
      });
    }
  }
  return sounds;
}
