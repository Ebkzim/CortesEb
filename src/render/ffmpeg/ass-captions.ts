import type { CaptionPage } from '../../contracts/render.js';

export interface AssStyle {
  fontName: string;
  fontSize: number;
  outline: number;
  highlight: string;
  base: string;
  width: number;
  height: number;
  centerY: number;
  sideMargin: number;
  shadowY: number;
  shadowAlpha: number;
}

export interface AssHeadline {
  text: string;
  totalMs: number;
  fontSize: number;
  top: number;
}

export interface AssCredit {
  text: string;
  totalMs: number;
  fontSize: number;
  bottomY: number;
}

const HEAD_MARGIN = 70;
const FORBIDDEN = /[{}\\\r\n]/g;

export function assColor(hex: string): string {
  const value = hex.replace('#', '');
  const r = value.slice(0, 2);
  const g = value.slice(2, 4);
  const b = value.slice(4, 6);
  return `&H${b}${g}${r}&`.toUpperCase();
}

export function assTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10));
  const cs = total % 100;
  const seconds = Math.floor(total / 100) % 60;
  const minutes = Math.floor(total / 6000) % 60;
  const hours = Math.floor(total / 360000);
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(cs)}`;
}

export function buildAssCaptions(
  pages: readonly CaptionPage[],
  style: AssStyle,
  credit: AssCredit | null = null,
  headline: AssHeadline | null = null,
): string {
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${style.width}`,
    `PlayResY: ${style.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${style.fontName},${style.fontSize},${assColor(style.base)},${assColor(style.base)},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,${style.outline},0,5,${style.sideMargin},${style.sideMargin},0,1`,
    ...(headline === null
      ? []
      : [
          `Style: Head,${style.fontName},${headline.fontSize},&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,5,0,8,${HEAD_MARGIN},${HEAD_MARGIN},${headline.top},1`,
        ]),
    ...(credit === null
      ? []
      : [
          `Style: Credit,${style.fontName},${credit.fontSize},&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,3,0,2,${style.sideMargin},${style.sideMargin},0,1`,
        ]),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  for (const page of pages) {
    for (const slice of slices(page)) {
      lines.push(
        `Dialogue: 0,${assTime(slice.from)},${assTime(slice.to)},Cap,,0,0,0,,${text(page, slice.active, style)}`,
      );
    }
  }
  if (headline !== null) {
    lines.push(
      `Dialogue: 1,${assTime(0)},${assTime(headline.totalMs)},Head,,0,0,0,,${headline.text.replace(FORBIDDEN, '').toUpperCase()}`,
    );
  }
  if (credit !== null) {
    lines.push(
      `Dialogue: 1,${assTime(0)},${assTime(credit.totalMs)},Credit,,0,0,0,,{\\an2\\pos(${style.width / 2},${credit.bottomY})\\alpha&H33&}${credit.text.replace(FORBIDDEN, '')}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

interface Slice {
  from: number;
  to: number;
  active: number;
}

function slices(page: CaptionPage): Slice[] {
  const points = new Set<number>([page.startMs, page.endMs]);
  for (const word of page.words) {
    points.add(Math.min(page.endMs, Math.max(page.startMs, word.startMs)));
    points.add(Math.min(page.endMs, Math.max(page.startMs, word.endMs)));
  }
  const ordered = [...points].sort((a, b) => a - b);
  const result: Slice[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index];
    const to = ordered[index + 1];
    if (from === undefined || to === undefined || to <= from) continue;
    const active = page.words.findIndex((word) => from >= word.startMs && from < word.endMs);
    result.push({ from, to, active });
  }
  return result;
}

function text(page: CaptionPage, active: number, style: AssStyle): string {
  const position = `{\\an5\\pos(${style.width / 2},${style.centerY})\\xshad0\\yshad${style.shadowY}\\4c&H000000&\\4a&H${shadowAlpha(style.shadowAlpha)}&}`;
  const words = page.words.map((word, index) => {
    const clean = word.text.replace(FORBIDDEN, '');
    return index === active
      ? `{\\c${assColor(style.highlight)}}${clean}{\\c${assColor(style.base)}}`
      : clean;
  });
  return `${position}${words.join(' ')}`;
}

function shadowAlpha(opacity: number): string {
  const value = Math.round(255 * (1 - opacity));
  return value.toString(16).padStart(2, '0').toUpperCase();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
