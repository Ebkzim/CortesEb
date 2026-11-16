import type { Crop, Focus } from './cuts.js';

export interface RenderWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionPage {
  words: RenderWord[];
  startMs: number;
  endMs: number;
}

export interface RenderSegment {
  from: number;
  to: number;
  turn: boolean;
}

export interface RenderSound {
  file: string;
  at: number;
  volume: number;
}

export interface RenderImage {
  file: string;
  at: number;
  dur: number;
}

export interface RenderWatermark {
  logo: string;
  name: string;
}

export interface SplitCutProps {
  totalSeconds: number;
  segments: RenderSegment[];
  sourceFile: string;
  bottomFile: string;
  bottomStart: number;
  bottomDuration: number;
  focus: Focus;
  crop: Crop | null;
  sourceWidth: number;
  sourceHeight: number;
  pages: CaptionPage[];
  watermark: RenderWatermark;
  sfx: RenderSound[];
  images: RenderImage[];
}

export const RENDER_FPS = 30;
export const RENDER_WIDTH = 1080;
export const RENDER_HEIGHT = 1920;
export const SPLIT_CUT_COMPOSITION = 'SplitCut';
