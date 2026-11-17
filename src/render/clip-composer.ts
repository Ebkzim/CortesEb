import { Injectable } from '@nestjs/common';
import type { Clip } from '../contracts/cuts.js';
import type { Silence, SourceMeta, Word } from '../contracts/media.js';
import { RENDER_FPS, type RenderImage, type SplitCutProps } from '../contracts/render.js';
import { ImageResolver } from '../images/image-resolver.js';
import { bottomStartFor, planClip } from '../timeline/plan.js';
import { toOutputTime } from '../timeline/spans.js';
import type { Workspace } from '../workspace/workspace.js';
import { planSounds, type StagedSounds } from './sound-plan.js';

export interface RenderContext {
  workspace: Workspace;
  words: readonly Word[];
  silences: readonly Silence[];
  meta: SourceMeta;
  sourceDuration: number;
  bottomDuration: number;
  sounds: StagedSounds;
  sfxGain: number;
}

export type ClipBase = Omit<SplitCutProps, 'watermark'>;

export interface ComposedClip {
  props: ClipBase;
  warnings: string[];
}

const DEFAULT_IMAGE_SECONDS = 2.2;

@Injectable()
export class ClipComposer {
  constructor(private readonly images: ImageResolver) {}

  async compose(clip: Clip, index: number, context: RenderContext): Promise<ComposedClip> {
    const plan = planClip({
      clip,
      words: context.words,
      silences: context.silences,
      sourceDuration: context.sourceDuration,
      fps: RENDER_FPS,
    });
    const warnings: string[] = [];
    const images: RenderImage[] = [];
    for (const [position, image] of clip.images.entries()) {
      const resolved = await this.images.resolve(
        image,
        context.workspace,
        `img-${clip.id}-${position}`,
      );
      if (resolved.warning !== null) warnings.push(resolved.warning);
      if (resolved.file === null) continue;
      images.push({
        file: resolved.file,
        at: toOutputTime(plan.placed, image.at),
        dur: image.dur ?? DEFAULT_IMAGE_SECONDS,
      });
    }
    const bottomStart =
      clip.bottom === 'source' ? 0 : bottomStartFor(clip, index, context.bottomDuration);
    return {
      warnings,
      props: {
        totalSeconds: plan.totalSeconds,
        segments: plan.segments,
        sourceFile: 'source.mp4',
        bottomFile: 'bottom.mp4',
        bottomSource: clip.bottom === 'source' ? { crop: clip.bottomCrop ?? null } : null,
        bottomStart,
        bottomDuration: Math.max(0, context.bottomDuration - bottomStart),
        focus: clip.focus,
        crop: clip.crop ?? null,
        sourceWidth: context.meta.width,
        sourceHeight: context.meta.height,
        pages: plan.pages,
        sfx: planSounds(
          plan.placed,
          images.map((image) => image.at),
          context.sounds,
          context.sfxGain,
        ),
        images,
      },
    };
  }
}
