import type { Crop, Focus } from '../../contracts/cuts.js';
import {
  RENDER_FPS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  type SplitCutProps,
} from '../../contracts/render.js';

export interface GraphFiles {
  assFile: string;
  fontsDir: string;
  dividerFile: string;
  watermark: { file: string; width: number } | null;
  hasAudio: boolean;
}

export interface GraphPlan {
  inputs: string[];
  script: string;
  video: string;
  audio: string;
}

const W = RENDER_WIDTH;
const H = RENDER_HEIGHT;
const TOP = H / 2;
const FPS = RENDER_FPS;
const PUNCH_SECONDS = 9 / FPS;
const FLASH_SECONDS = 5 / FPS;
const FLASH_LEVEL = 0.3;
const DIVIDER_HEIGHT = 340;
const WATERMARK_TOP = 150;
const WATERMARK_RIGHT = 40;
const POP_MAX_WIDTH = 800;
const POP_MAX_HEIGHT = 620;
const POP_INSET = 70;
const POP_IN = 8 / FPS;
const POP_OUT = 6 / FPS;
const AUDIO_RATE = 44100;
const FIRST_PUNCH = 1.12;
const ODD_PUNCH = 1.06;
const CENTER: Focus = { x: 50, y: 50 };
const FIT_BLUR = 28;
const FIT_DIM = -0.22;

export function buildGraph(props: SplitCutProps, files: GraphFiles): GraphPlan {
  const segments = props.segments;
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (first === undefined || last === undefined) throw new Error('sem trechos para montar');
  const origin = first.from;
  const span = last.to - origin;
  const total = props.totalSeconds;
  const inputs: string[] = [];
  const lines: string[] = [];
  let next = 0;
  const addInput = (...args: string[]): number => {
    inputs.push(...args);
    const index = next;
    next += 1;
    return index;
  };

  const source = addInput('-ss', sec(origin), '-t', sec(span), '-i', props.sourceFile);
  const fit = props.frame === 'fit';
  const bottomVideo =
    !fit && props.bottomSource === null
      ? addInput(
          '-stream_loop',
          '-1',
          '-ss',
          sec(props.bottomStart),
          '-t',
          sec(total),
          '-i',
          props.bottomFile,
        )
      : null;
  const divider = fit ? -1 : addInput(...stillArgs(total), '-i', files.dividerFile);
  const watermark =
    files.watermark === null ? null : addInput(...stillArgs(total), '-i', files.watermark.file);
  const imageInputs = props.images.map((image) =>
    addInput(...stillArgs(image.dur), '-i', image.file),
  );
  const soundInputs = props.sfx.map((sound) => addInput('-i', sound.file));
  const silence = files.hasAudio
    ? null
    : addInput('-f', 'lavfi', '-t', sec(total), '-i', `anullsrc=r=${AUDIO_RATE}:cl=stereo`);

  const count = segments.length;
  const dual = !fit && props.bottomSource !== null;

  lines.push(
    dual ? `[${source}:v]fps=${FPS},split=2[srcT][srcB]` : `[${source}:v]fps=${FPS}[srcT]`,
  );
  lines.push(fit ? `[srcT]setsar=1[topc]` : `[srcT]${cover(props.crop, props.focus, props)}[topc]`);
  lines.push(fan('topc', 't', count));
  if (props.bottomSource !== null) {
    lines.push(`[srcB]${cover(props.bottomSource.crop, CENTER, props)}[botc]`);
    lines.push(fan('botc', 'b', count));
  }
  if (files.hasAudio) {
    lines.push(
      `[${source}:a]aresample=${AUDIO_RATE},aformat=channel_layouts=stereo,${asplit(count)}${labels('a', count)}`,
    );
  }

  const concat: string[] = [];
  segments.forEach((segment, index) => {
    const from = sec(segment.from - origin);
    const to = sec(segment.to - origin);
    const punch = fit ? 1 : punchFactor(index);
    const zoom =
      punch > 1
        ? `,scale=w='iw*(1+(${punch - 1})*pow(1-min(1,t/${PUNCH_SECONDS.toFixed(4)}),3))':h='ih*(1+(${punch - 1})*pow(1-min(1,t/${PUNCH_SECONDS.toFixed(4)}),3))':eval=frame,crop=${W}:${TOP}`
        : '';
    lines.push(
      `[t${index}]trim=start=${from}:end=${to},setpts=PTS-STARTPTS${zoom},setsar=1[tv${index}]`,
    );
    concat.push(`[tv${index}]`);
    if (dual) {
      lines.push(
        `[b${index}]trim=start=${from}:end=${to},setpts=PTS-STARTPTS,setsar=1[bv${index}]`,
      );
      concat.push(`[bv${index}]`);
    }
    if (files.hasAudio) {
      lines.push(`[a${index}]atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS[av${index}]`);
      concat.push(`[av${index}]`);
    }
  });
  const concatOut = [
    `[topcat]`,
    ...(dual ? [`[botcat]`] : []),
    ...(files.hasAudio ? [`[acat]`] : []),
  ];
  lines.push(
    `${concat.join('')}concat=n=${count}:v=${dual ? 2 : 1}:a=${files.hasAudio ? 1 : 0}${concatOut.join('')}`,
  );

  const flashes = flashFilters(props);
  if (fit) {
    lines.push(`[topcat]split=2[fitfg][fitbg]`);
    lines.push(
      `[fitbg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=${FIT_BLUR}:luma_power=2,eq=brightness=${FIT_DIM}:saturation=0.85[fitback]`,
    );
    lines.push(`[fitfg]scale=${W}:-2[fitfront]`);
    lines.push(`[fitback][fitfront]overlay=x=0:y='(H-h)/2'[fitted]`);
    lines.push(`[fitted]${flashes === '' ? 'null' : flashes}[stack]`);
  } else {
    lines.push(`[topcat]${flashes === '' ? 'null' : flashes}[topf]`);
    lines.push(
      bottomVideo === null
        ? `[botcat]null[bot]`
        : `[${bottomVideo}:v]fps=${FPS},${cover(null, CENTER, props)}[bot]`,
    );
    lines.push(`[topf][bot]vstack=inputs=2[stack]`);
  }

  let current = 'stack';
  props.images.forEach((image, index) => {
    const input = imageInputs[index];
    if (input === undefined) return;
    const dur = image.dur;
    lines.push(
      `[${input}:v]scale=${POP_MAX_WIDTH}:${POP_MAX_HEIGHT}:force_original_aspect_ratio=decrease,pad=w=iw+10:h=ih+10:x=5:y=5:color=white,format=rgba,fade=t=in:st=0:d=${POP_IN.toFixed(3)}:alpha=1,fade=t=out:st=${Math.max(0, dur - POP_OUT).toFixed(3)}:d=${POP_OUT.toFixed(3)}:alpha=1,setpts=PTS+${sec(image.at)}/TB[img${index}]`,
    );
    lines.push(
      `[${current}][img${index}]overlay=x='(W-w)/2':y='${TOP + POP_INSET}+(${TOP - POP_INSET * 2}-h)/2':eof_action=pass:format=auto[ov${index}]`,
    );
    current = `ov${index}`;
  });
  lines.push(
    fit
      ? `[${current}]null[withdiv]`
      : `[${current}][${divider}:v]overlay=x=0:y=${TOP - DIVIDER_HEIGHT / 2}:eof_action=pass:format=auto[withdiv]`,
  );
  lines.push(`[withdiv]ass=${files.assFile}:fontsdir=${escapeValue(files.fontsDir)}[cap]`);
  if (watermark !== null && files.watermark !== null) {
    lines.push(
      `[cap][${watermark}:v]overlay=x=${W - WATERMARK_RIGHT - files.watermark.width}:y=${WATERMARK_TOP}:eof_action=pass:format=auto[wm]`,
    );
    lines.push(`[wm]format=yuv420p[vout]`);
  } else {
    lines.push(`[cap]format=yuv420p[vout]`);
  }

  const base = files.hasAudio ? 'acat' : `sil`;
  if (!files.hasAudio && silence !== null) {
    lines.push(`[${silence}:a]aformat=sample_rates=${AUDIO_RATE}:channel_layouts=stereo[sil]`);
  }
  if (props.sfx.length === 0) {
    lines.push(`[${base}]anull[aout]`);
  } else {
    const parts = props.sfx.map((sound, index) => {
      const input = soundInputs[index];
      const delay = Math.max(0, Math.round(sound.at * 1000));
      lines.push(
        `[${input}:a]aformat=sample_rates=${AUDIO_RATE}:channel_layouts=stereo,volume=${sound.volume.toFixed(3)},adelay=${delay}:all=1[sf${index}]`,
      );
      return `[sf${index}]`;
    });
    lines.push(
      `[${base}]${parts.join('')}amix=inputs=${props.sfx.length + 1}:normalize=0:duration=first:dropout_transition=0[aout]`,
    );
  }

  return { inputs, script: `${lines.join(';\n')}\n`, video: 'vout', audio: 'aout' };

  function flashFilters(source: SplitCutProps): string {
    let offset = 0;
    const filters: string[] = [];
    source.segments.forEach((segment) => {
      const frames = Math.max(1, Math.round((segment.to - segment.from) * FPS));
      const start = offset / FPS;
      offset += frames;
      if (!segment.turn) return;
      const end = start + FLASH_SECONDS;
      filters.push(
        `eq=brightness='${FLASH_LEVEL}*(1-(t-${start.toFixed(4)})/${FLASH_SECONDS.toFixed(4)})':eval=frame:enable='between(t,${start.toFixed(4)},${end.toFixed(4)})'`,
      );
    });
    return filters.join(',');
  }
}

export function cover(crop: Crop | null, focus: Focus, bounds: SplitCutProps): string {
  const fit = `scale=${W}:${TOP}:force_original_aspect_ratio=increase`;
  if (crop === null) {
    return `${fit},crop=${W}:${TOP}:'(iw-${W})*${num(focus.x / 100)}':'(ih-${TOP})*${num(focus.y / 100)}'`;
  }
  const fitted = clampCrop(crop, bounds.sourceWidth, bounds.sourceHeight);
  return `crop=${fitted.w}:${fitted.h}:${fitted.x}:${fitted.y},${fit},crop=${W}:${TOP}`;
}

export function clampCrop(crop: Crop, width: number, height: number): Crop {
  const w = Math.max(2, Math.min(Math.round(crop.w), width));
  const h = Math.max(2, Math.min(Math.round(crop.h), height));
  const x = Math.max(0, Math.min(Math.round(crop.x), width - w));
  const y = Math.max(0, Math.min(Math.round(crop.y), height - h));
  return { x, y, w, h };
}

export function escapeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function punchFactor(index: number): number {
  if (index === 0) return FIRST_PUNCH;
  return index % 2 === 1 ? ODD_PUNCH : 1;
}

function fan(from: string, prefix: string, count: number): string {
  return count === 1
    ? `[${from}]null[${prefix}0]`
    : `[${from}]split=${count}${labels(prefix, count)}`;
}

function asplit(count: number): string {
  return count === 1 ? 'anull' : `asplit=${count}`;
}

function labels(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `[${prefix}${index}]`).join('');
}

function stillArgs(duration: number): string[] {
  return ['-loop', '1', '-framerate', String(FPS), '-t', sec(duration)];
}

function sec(value: number): string {
  return Math.max(0, value).toFixed(3);
}

function num(value: number): string {
  return value.toFixed(4);
}
