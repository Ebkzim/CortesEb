import type { Crop, Focus } from './cuts.js';

export type RenderWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type CaptionPage = {
  words: RenderWord[];
  startMs: number;
  endMs: number;
};

export type RenderSegment = {
  from: number;
  to: number;
  turn: boolean;
};

export type RenderSound = {
  file: string;
  at: number;
  volume: number;
};

export type RenderImage = {
  file: string;
  at: number;
  dur: number;
};

export type RenderWatermark = {
  logo: string | null;
  name: string | null;
};

export type SplitCutProps = {
  totalSeconds: number;
  segments: RenderSegment[];
  sourceFile: string;
  bottomFile: string;
  bottomSource: { crop: Crop | null } | null;
  bottomStart: number;
  bottomDuration: number;
  focus: Focus;
  crop: Crop | null;
  sourceWidth: number;
  sourceHeight: number;
  pages: CaptionPage[];
  watermark: RenderWatermark | null;
  credit?: string | null;
  sfx: RenderSound[];
  images: RenderImage[];
};

export const RENDER_FPS = 30;
export const RENDER_WIDTH = 1080;
export const RENDER_HEIGHT = 1920;
export const SPLIT_CUT_COMPOSITION = 'SplitCut';
