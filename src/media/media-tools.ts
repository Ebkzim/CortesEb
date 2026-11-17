import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { ProcessRunner } from '../common/process-runner.js';
import type { Silence, SourceMeta } from '../contracts/media.js';
import { parseSilences } from './silence-parser.js';

export interface SilenceDetection {
  noiseDb: number;
  minSeconds: number;
}

export const SILENCE_DETECTION: SilenceDetection = { noiseDb: -35, minSeconds: 0.45 };

const probeSchema = z.object({
  streams: z
    .array(
      z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        r_frame_rate: z.string(),
      }),
    )
    .min(1),
  format: z.object({ duration: z.coerce.number().positive() }),
});

@Injectable()
export class MediaTools {
  constructor(private readonly runner: ProcessRunner) {}

  async probe(video: string): Promise<SourceMeta> {
    const { stdout } = await this.runner.exec('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate:format=duration',
      '-of',
      'json',
      path.resolve(video),
    ]);
    const parsed = probeSchema.safeParse(safeJson(stdout));
    const stream = parsed.success ? parsed.data.streams[0] : undefined;
    if (!parsed.success || stream === undefined) {
      throw new AppError('INVALID_INPUT', `${path.basename(video)} não tem faixa de vídeo legível`);
    }
    return {
      duration: parsed.data.format.duration,
      width: stream.width,
      height: stream.height,
      fps: stream.r_frame_rate,
    };
  }

  async duration(file: string): Promise<number> {
    const { stdout } = await this.runner.exec('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      path.resolve(file),
    ]);
    const value = Number(stdout.trim());
    if (!Number.isFinite(value) || value <= 0) {
      throw new AppError('INVALID_INPUT', `não consegui medir a duração de ${path.basename(file)}`);
    }
    return value;
  }

  async extractAudio(
    video: string,
    wav: string,
    maxSeconds?: number,
    startSeconds = 0,
  ): Promise<void> {
    const limit = maxSeconds === undefined ? [] : ['-t', String(maxSeconds)];
    const seek = startSeconds > 0 ? ['-ss', String(startSeconds)] : [];
    await this.runner.exec('ffmpeg', [
      '-y',
      '-v',
      'error',
      ...seek,
      '-i',
      path.resolve(video),
      ...limit,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      path.resolve(wav),
    ]);
  }

  async detectSilences(
    audio: string,
    totalDuration: number,
    detection: SilenceDetection = SILENCE_DETECTION,
  ): Promise<Silence[]> {
    const filter = `silencedetect=noise=${detection.noiseDb}dB:d=${detection.minSeconds}`;
    const { stderr } = await this.runner.exec('ffmpeg', [
      '-hide_banner',
      '-i',
      path.resolve(audio),
      '-af',
      filter,
      '-f',
      'null',
      '-',
    ]);
    return parseSilences(stderr, totalDuration);
  }

  async frame(video: string, atSeconds: number, output: string): Promise<void> {
    await this.runner.exec('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-ss',
      String(atSeconds),
      '-i',
      path.resolve(video),
      '-frames:v',
      '1',
      path.resolve(output),
    ]);
  }

  async toMp4(input: string, output: string): Promise<void> {
    await this.runner.exec(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-i',
        path.resolve(input),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        path.resolve(output),
      ],
      { stream: true },
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
