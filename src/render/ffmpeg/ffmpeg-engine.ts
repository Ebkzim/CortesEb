import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ProcessRunner } from '../../common/process-runner.js';
import { AppPaths } from '../../config/app-paths.js';
import {
  RENDER_FPS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  type SplitCutProps,
} from '../../contracts/render.js';
import type { RenderEngine, RenderSession } from '../render-engine.js';
import {
  buildAssCaptions,
  type AssCredit,
  type AssHeadline,
  type AssStyle,
} from './ass-captions.js';
import { buildGraph, scriptOption } from './filter-graph.js';
import { cellHeightRatio } from './text-metrics.js';
import { planWatermark, writeTextFile } from './watermark-image.js';

const FONT_FILE = 'Montserrat-Black.ttf';
const FONT_NAME = 'Montserrat Black';
const CAPTION_SIZE = 96;
const HEADLINE_SIZE = 64;
const HEADLINE_TOP = 400;
const FIT_CAPTION_Y = 1440;
const CREDIT_SIZE = 34;
const CREDIT_BOTTOM = 60;
const DIVIDER_HEIGHT = 340;
const DIVIDER_FILE = 'divider.png';
const CRF = '20';
const PRESET = 'veryfast';

@Injectable()
export class FfmpegEngine implements RenderEngine {
  constructor(
    private readonly paths: AppPaths,
    private readonly runner: ProcessRunner,
  ) {}

  private scriptFlag: Promise<string> | null = null;

  private filterScriptFlag(): Promise<string> {
    this.scriptFlag ??= this.runner
      .exec('ffmpeg', ['-hide_banner', '-version'])
      .then((result) => scriptOption(result.stdout))
      .catch(() => {
        this.scriptFlag = null;
        return scriptOption('');
      });
    return this.scriptFlag;
  }

  open(publicDir: string): Promise<RenderSession> {
    return Promise.resolve({ serveUrl: publicDir, dispose: () => Promise.resolve() });
  }

  async render(
    session: RenderSession,
    props: SplitCutProps,
    output: string,
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    const root = session.serveUrl;
    const tag = createHash('sha1').update(output).digest('hex').slice(0, 10);
    const fontFile = path.join(this.paths.fontsDir, FONT_FILE);
    const assFile = `captions-${tag}.ass`;
    const scriptFile = `graph-${tag}.txt`;
    await this.ensureDivider(root);
    await fs.writeFile(
      path.join(root, assFile),
      buildAssCaptions(
        props.pages,
        this.assStyle(fontFile, props.frame === 'fit'),
        this.credit(props, fontFile),
        this.headline(props, fontFile),
      ),
    );
    const watermark = await this.buildWatermark(root, props, fontFile, tag);
    const hasAudio = await this.hasAudio(root, props.sourceFile);
    const plan = buildGraph(props, {
      assFile,
      fontsDir: this.paths.fontsDir,
      dividerFile: DIVIDER_FILE,
      watermark,
      hasAudio,
    });
    await fs.writeFile(path.join(root, scriptFile), plan.script, 'utf8');
    const scriptFlag = await this.filterScriptFlag();
    try {
      await this.runner.exec(
        'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-nostdin',
          '-nostats',
          '-progress',
          'pipe:1',
          ...plan.inputs,
          scriptFlag,
          scriptFile,
          '-map',
          `[${plan.video}]`,
          '-map',
          `[${plan.audio}]`,
          '-c:v',
          'libx264',
          '-preset',
          PRESET,
          '-crf',
          CRF,
          '-pix_fmt',
          'yuv420p',
          '-r',
          String(RENDER_FPS),
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          '-t',
          props.totalSeconds.toFixed(3),
          path.resolve(output),
        ],
        {
          cwd: root,
          onLine: (line) => {
            const done = renderedSeconds(line);
            if (done !== null && onProgress !== undefined && props.totalSeconds > 0) {
              onProgress(done / props.totalSeconds);
            }
          },
        },
      );
    } finally {
      await Promise.all(
        [assFile, scriptFile, `wm-${tag}.png`, `wm-${tag}.txt`].map((file) =>
          fs.rm(path.join(root, file), { force: true }),
        ),
      );
    }
  }

  private credit(props: SplitCutProps, fontFile: string): AssCredit | null {
    if (props.credit === undefined || props.credit === null) return null;
    return {
      text: props.credit,
      totalMs: Math.round(props.totalSeconds * 1000),
      fontSize: Math.round(CREDIT_SIZE * cellHeightRatio(fontFile)),
      bottomY: RENDER_HEIGHT - CREDIT_BOTTOM,
    };
  }

  private headline(props: SplitCutProps, fontFile: string): AssHeadline | null {
    if (props.frame !== 'fit' || props.headline === undefined || props.headline === null)
      return null;
    const text = props.headline.trim();
    if (text === '') return null;
    return {
      text,
      totalMs: Math.round(props.totalSeconds * 1000),
      fontSize: Math.round(HEADLINE_SIZE * cellHeightRatio(fontFile)),
      top: HEADLINE_TOP,
    };
  }

  private assStyle(fontFile: string, fit = false): AssStyle {
    return {
      fontName: FONT_NAME,
      fontSize: Math.round(CAPTION_SIZE * cellHeightRatio(fontFile)),
      outline: 6,
      highlight: '#FFD400',
      base: '#FFFFFF',
      width: RENDER_WIDTH,
      height: RENDER_HEIGHT,
      centerY: fit ? FIT_CAPTION_Y : RENDER_HEIGHT / 2,
      sideMargin: 50,
      shadowY: 7,
      shadowAlpha: 0.35,
    };
  }

  private async ensureDivider(root: string): Promise<void> {
    await this.runner.exec(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${RENDER_WIDTH}x${DIVIDER_HEIGHT},format=rgba,geq=r='0':g='0':b='0':a='255*0.62*(1-abs(Y-${DIVIDER_HEIGHT / 2 - 0.5})/${DIVIDER_HEIGHT / 2})'`,
        '-frames:v',
        '1',
        DIVIDER_FILE,
      ],
      { cwd: root },
    );
  }

  private async buildWatermark(
    root: string,
    props: SplitCutProps,
    fontFile: string,
    tag: string,
  ): Promise<{ file: string; width: number } | null> {
    if (props.watermark === null) return null;
    const output = `wm-${tag}.png`;
    const command = planWatermark(props.watermark, fontFile, `wm-${tag}.txt`, output);
    if (command === null) return null;
    if (command.textFile !== null) {
      await writeTextFile(path.join(root, command.textFile.name), command.textFile.content);
    }
    await this.runner.exec('ffmpeg', command.args, { cwd: root });
    return { file: output, width: command.width };
  }

  private async hasAudio(root: string, file: string): Promise<boolean> {
    const result = await this.runner.exec(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        file,
      ],
      { cwd: root },
    );
    return result.stdout.trim() !== '';
  }
}

export function renderedSeconds(line: string): number | null {
  const match = /^out_time_us=(\d+)$/.exec(line.trim());
  if (match?.[1] === undefined) return null;
  return Number(match[1]) / 1_000_000;
}
