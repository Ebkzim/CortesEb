import { RENDER_HEIGHT, RENDER_WIDTH } from '../src/contracts/render';

export const frame = {
  width: RENDER_WIDTH,
  height: RENDER_HEIGHT,
  topHeight: RENDER_HEIGHT / 2,
} as const;

export const colors = {
  background: '#000',
  text: '#fff',
  highlight: '#FFD400',
  stroke: '#000',
  watermarkStroke: '#14002a',
  watermarkShadow: 'rgba(60,0,90,0.6)',
} as const;

export const motion = {
  punchFrames: 9,
  firstPunch: 1.12,
  oddPunch: 1.06,
  flashFrames: 5,
  flashOpacity: 0.38,
  popInFrames: 8,
  popOutFrames: 6,
  minPopFrames: 12,
  soundSeconds: 3,
} as const;

export const captionStyle = {
  fontSize: 96,
  lineHeight: 1.04,
  strokeWidth: 11,
  sideMargin: 50,
  wordGap: 12,
} as const;

export const watermarkStyle = {
  top: 150,
  right: 40,
  logoSize: 104,
  fontSize: 40,
  gap: 14,
} as const;

export const dividerStyle = {
  height: 340,
} as const;

export const popStyle = {
  inset: 70,
  maxWidth: 800,
  maxHeight: 620,
} as const;
