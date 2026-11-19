import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';

const cache = new Map<string, opentype.Font>();

function load(fontFile: string): opentype.Font {
  const cached = cache.get(fontFile);
  if (cached !== undefined) return cached;
  const font = opentype.parse(readFileSync(fontFile));
  cache.set(fontFile, font);
  return font;
}

export function measureWidth(fontFile: string, text: string, size: number): number {
  return load(fontFile).getAdvanceWidth(text, size);
}

interface WinMetrics {
  usWinAscent: number;
  usWinDescent: number;
}

export function cellHeightRatio(fontFile: string): number {
  const font = load(fontFile);
  const os2 = font.tables['os2'] as WinMetrics | undefined;
  if (os2 !== undefined && os2.usWinAscent + os2.usWinDescent > 0) {
    return (os2.usWinAscent + os2.usWinDescent) / font.unitsPerEm;
  }
  return (font.ascender - font.descender) / font.unitsPerEm;
}
