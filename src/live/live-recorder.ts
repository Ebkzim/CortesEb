import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { ProcessRunner } from '../common/process-runner.js';
import { assertPublicHost, parsePublicUrl } from '../common/safe-url.js';
import { YtDlp } from '../download/yt-dlp.js';
import { RmsStreamParser, type RmsSample } from './rms-stream.js';

export const STREAM_PROTOCOLS = 'https,tls,tcp,crypto';

const RESOLVE_TIMEOUT_MS = 90_000;
const SEGMENT_SECONDS = 3;
const KILL_GRACE_MS = 6_000;
const AUDIO_FILTER =
  'aresample=16000,asetnsamples=n=16000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level';

export interface ResolvedStream {
  live: boolean;
  url: string;
}

export interface RecordingRequest {
  input: string;
  dir: string;
  epoch: number;
  protocols?: string;
}

export interface Recording {
  list: string;
  exited: Promise<number>;
  stop(): void;
}

export function segmentPattern(dir: string, epoch: number): string {
  return path.join(dir, `e${epoch}-%06d.ts`);
}

export function segmentList(dir: string, epoch: number): string {
  return path.join(dir, `e${epoch}.csv`);
}

export function recorderArgs(request: RecordingRequest): string[] {
  return [
    '-hide_banner',
    '-v',
    'info',
    '-nostdin',
    '-nostats',
    '-protocol_whitelist',
    request.protocols ?? STREAM_PROTOCOLS,
    '-i',
    request.input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-c',
    'copy',
    '-f',
    'segment',
    '-segment_time',
    String(SEGMENT_SECONDS),
    '-segment_format',
    'mpegts',
    '-reset_timestamps',
    '1',
    '-segment_list',
    segmentList(request.dir, request.epoch),
    '-segment_list_type',
    'csv',
    segmentPattern(request.dir, request.epoch),
    '-map',
    '0:a:0',
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-af',
    AUDIO_FILTER,
    '-f',
    'null',
    '-',
  ];
}

@Injectable()
export class LiveRecorder {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly ytDlp: YtDlp,
  ) {}

  async resolve(link: string, maxHeight: number): Promise<ResolvedStream> {
    const page = parsePublicUrl(link);
    const base = await this.ytDlp.baseArgs();
    const result = await this.runner.run(
      'yt-dlp',
      [
        ...base,
        '--print',
        '%(is_live)s',
        '--print',
        '%(urls)s',
        '-f',
        `best[height<=${maxHeight}]/best`,
        '--',
        page.toString(),
      ],
      { timeoutMs: RESOLVE_TIMEOUT_MS },
    );
    const [flag, first] = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (result.code !== 0 || flag === undefined || first === undefined) {
      const detail = result.stderr.trim().split(/\r?\n/).slice(-1).join(' ');
      throw new AppError('REMOTE_FAILED', `a live não está disponível: ${detail}`);
    }
    const stream = parsePublicUrl(first);
    await assertPublicHost(stream);
    return { live: flag === 'True', url: stream.toString() };
  }

  async snapshot(input: string, output: string, protocols = STREAM_PROTOCOLS): Promise<void> {
    await this.runner.exec(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        protocols,
        '-i',
        input,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        path.resolve(output),
      ],
      { timeoutMs: RESOLVE_TIMEOUT_MS },
    );
  }

  start(request: RecordingRequest, onSample: (sample: RmsSample) => void): Recording {
    const child = this.runner.start('ffmpeg', recorderArgs(request));
    const parser = new RmsStreamParser();
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      for (const sample of parser.push(chunk)) onSample(sample);
    });
    const exited = new Promise<number>((resolve) => {
      child.on('close', (code) => {
        resolve(code ?? 1);
      });
    });
    return {
      list: segmentList(request.dir, request.epoch),
      exited,
      stop: () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill('SIGINT');
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, KILL_GRACE_MS).unref();
      },
    };
  }
}
