import type { Crop } from '../contracts/cuts.js';
import { AppError } from '../common/app-error.js';

export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export type Corner = (typeof CORNERS)[number];

export type CameraSpec =
  | { kind: 'corner'; corner: Corner; size: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number };

const TOP_RATIO = 1080 / 960;
const MIN_SIZE = 10;
const MAX_SIZE = 100;

export function parseCamera(spec: string, size: number): CameraSpec {
  const text = spec.trim().toLowerCase();
  if ((CORNERS as readonly string[]).includes(text)) {
    return { kind: 'corner', corner: text as Corner, size: clamp(size, MIN_SIZE, MAX_SIZE) };
  }
  const parts = text.split(',').map((part) => Number(part.trim()));
  const [x, y, w, h] = parts;
  const valid =
    parts.length === 4 &&
    parts.every((value) => Number.isFinite(value)) &&
    x !== undefined &&
    y !== undefined &&
    w !== undefined &&
    h !== undefined &&
    x >= 0 &&
    y >= 0 &&
    w > 0 &&
    h > 0 &&
    x + w <= 100 &&
    y + h <= 100;
  if (!valid) {
    throw new AppError(
      'INVALID_INPUT',
      `--camera aceita ${CORNERS.join(', ')} ou x,y,largura,altura em porcentagem`,
    );
  }
  return { kind: 'rect', x, y, w, h };
}

export function cameraCrop(camera: CameraSpec, width: number, height: number): Crop {
  if (camera.kind === 'rect') {
    return {
      x: Math.round((camera.x / 100) * width),
      y: Math.round((camera.y / 100) * height),
      w: Math.max(2, Math.round((camera.w / 100) * width)),
      h: Math.max(2, Math.round((camera.h / 100) * height)),
    };
  }
  let h = Math.round((camera.size / 100) * height);
  let w = Math.round(h * TOP_RATIO);
  if (w > width) {
    w = width;
    h = Math.round(w / TOP_RATIO);
  }
  const x = camera.corner.endsWith('left') ? 0 : width - w;
  const y = camera.corner.startsWith('top') ? 0 : height - h;
  return { x, y, w, h };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
