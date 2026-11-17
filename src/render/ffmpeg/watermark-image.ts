import fs from 'node:fs/promises';
import { escapeValue } from './filter-graph.js';
import { measureWidth } from './text-metrics.js';

export const LOGO_SIZE = 104;
const LOGO_GAP = 14;
const NAME_SIZE = 40;
const NAME_PAD = 8;
const NAME_ONLY_HEIGHT = 52;
const RING = 4;

export interface WatermarkSpec {
  logo: string | null;
  name: string | null;
}

export interface WatermarkCommand {
  width: number;
  height: number;
  args: string[];
  textFile: { name: string; content: string } | null;
}

export function planWatermark(
  spec: WatermarkSpec,
  fontFile: string,
  textFileName: string,
  output: string,
): WatermarkCommand | null {
  const name = spec.name === null ? null : spec.name.toUpperCase();
  if (spec.logo === null && name === null) return null;
  const nameWidth =
    name === null ? 0 : Math.ceil(measureWidth(fontFile, name, NAME_SIZE)) + NAME_PAD;
  const hasLogo = spec.logo !== null;
  const width = (hasLogo ? LOGO_SIZE : 0) + (hasLogo && name !== null ? LOGO_GAP : 0) + nameWidth;
  const height = hasLogo ? LOGO_SIZE : NAME_ONLY_HEIGHT;
  const inner = LOGO_SIZE - RING * 2;
  const centre = (LOGO_SIZE - 1) / 2;
  const logoCentre = (inner - 1) / 2;
  const chain: string[] = [`color=c=0x00000000:s=${width}x${height},format=rgba[canvas]`];
  let current = 'canvas';
  let inputs: string[] = [];
  if (spec.logo !== null) {
    inputs = ['-i', spec.logo];
    chain.push(
      `[0:v]scale=${inner}:${inner}:force_original_aspect_ratio=increase,crop=${inner}:${inner},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-${logoCentre},Y-${logoCentre}),${inner / 2}),255,0)'[logo]`,
      `color=c=white:s=${LOGO_SIZE}x${LOGO_SIZE},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-${centre},Y-${centre}),${LOGO_SIZE / 2}),255,0)'[ring]`,
      `[canvas][ring]overlay=0:0:format=auto[c1]`,
      `[c1][logo]overlay=${RING}:${RING}:format=auto[c2]`,
    );
    current = 'c2';
  }
  if (name !== null) {
    const x = hasLogo ? LOGO_SIZE + LOGO_GAP : 0;
    chain.push(
      `[${current}]drawtext=fontfile=${escapeValue(fontFile)}:textfile=${textFileName}:fontsize=${NAME_SIZE}:fontcolor=white:borderw=4:bordercolor=0x14002a:shadowx=0:shadowy=4:shadowcolor=0x3c005a@0.6:x=${x}:y=(${height}-text_h)/2[out]`,
    );
  } else {
    chain.push(`[${current}]null[out]`);
  }
  return {
    width,
    height,
    textFile: name === null ? null : { name: textFileName, content: name },
    args: [
      '-y',
      '-v',
      'error',
      '-nostdin',
      ...inputs,
      '-filter_complex',
      chain.join(';'),
      '-map',
      '[out]',
      '-frames:v',
      '1',
      output,
    ],
  };
}

export async function writeTextFile(file: string, content: string): Promise<void> {
  await fs.writeFile(file, content, 'utf8');
}
