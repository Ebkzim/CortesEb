import type { Clip } from '../contracts/cuts.js';
import type { Layout } from '../contracts/layout.js';
import type { SourceMeta } from '../contracts/media.js';
import { cameraCrop, parseCamera } from './camera.js';

export const NO_CAMERA = 'none';
export const DEFAULT_CAMERA_SIZE = 40;

export type ResolvedClip = Clip & { bottom: 'video' | 'source' };

export function mergeLayouts(workspace: Layout | null, saved: Layout): Layout {
  return {
    ...definedOnly(saved),
    ...definedOnly(workspace ?? {}),
  };
}

export function applyLayout(clip: Clip, layout: Layout, frame: SourceMeta): ResolvedClip {
  const bottom = clip.bottom ?? layout.bottom ?? 'video';
  if (clip.crop !== undefined || layout.camera === undefined || layout.camera === NO_CAMERA) {
    return { ...clip, bottom };
  }
  const camera = parseCamera(layout.camera, layout.cameraSize ?? DEFAULT_CAMERA_SIZE);
  return { ...clip, bottom, crop: cameraCrop(camera, frame.width, frame.height) };
}

function definedOnly(layout: Layout): Layout {
  return Object.fromEntries(Object.entries(layout).filter(([, value]) => value !== undefined));
}
