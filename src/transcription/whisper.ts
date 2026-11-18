import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  type TranscriptionJson,
} from '@remotion/install-whisper-cpp';
import { AppError } from '../common/app-error.js';
import { currentSignal, withCancellation } from '../common/cancellation.js';
import { ProcessRunner } from '../common/process-runner.js';
import { exists } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import type { UserConfig } from '../config/user-config.js';
import type { Word } from '../contracts/media.js';
import { dropLoops, dropMarkers, mergeTokens } from './tokens.js';

export const WHISPER_VERSION = '1.5.5';
const NO_CONTEXT_ARGS = ['--max-context', '0'];
const WAV_BYTES_PER_SECOND = 32_000;
const SLOWEST_RATIO = 40;
const MIN_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const STALL_MS = 15 * 60 * 1000;
const STALL_CHECK_MS = 30 * 1000;

@Injectable()
export class Whisper {
  constructor(
    private readonly paths: AppPaths,
    private readonly runner: ProcessRunner,
  ) {}

  isReady(model: UserConfig['whisperModel']): Promise<boolean> {
    return exists(this.paths.whisperModel(model));
  }

  async install(model: UserConfig['whisperModel']): Promise<void> {
    await installWhisperCpp({ to: this.paths.whisperDir, version: WHISPER_VERSION });
    await downloadWhisperModel({ model, folder: this.paths.whisperDir, printOutput: false });
  }

  async transcribe(
    audio: string,
    model: UserConfig['whisperModel'],
    language: string,
    onProgress?: (fraction: number) => void,
  ): Promise<Word[]> {
    if (!(await this.isReady(model))) {
      throw new AppError('NOT_CONFIGURED', `modelo ${model} não instalado: rode cortes-eb setup`);
    }
    const output = await this.run(audio, model, language, onProgress);
    return dropLoops(dropMarkers(mergeTokens(toCaptions({ whisperCppOutput: output }).captions)));
  }

  private async run(
    audio: string,
    model: UserConfig['whisperModel'],
    language: string,
    onProgress?: (fraction: number) => void,
  ): Promise<TranscriptionJson<true>> {
    const base = path.join(path.dirname(audio), `whisper-${randomUUID()}`);
    const target = `${base}.json`;
    const args = [
      '-f',
      audio,
      '--output-file',
      base,
      '--output-json',
      '--max-len',
      '1',
      '-ojf',
      '--dtw',
      model.replace(/-v(\d)/, '.v$1'),
      '-m',
      this.paths.whisperModel(model),
      '-pp',
      '-l',
      language.toLowerCase(),
      ...NO_CONTEXT_ARGS,
    ];
    const timeoutMs = await timeoutFor(audio);
    const outer = currentSignal();
    const stall = new AbortController();
    let lastProgress = Date.now();
    let stalled = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastProgress < STALL_MS) return;
      stalled = true;
      stall.abort();
    }, STALL_CHECK_MS);
    watchdog.unref();
    const signal = outer === undefined ? stall.signal : AbortSignal.any([outer, stall.signal]);
    const started = Date.now();
    try {
      const result = await withCancellation(signal, () =>
        this.runner.run(this.executable(), args, {
          cwd: this.paths.whisperDir,
          timeoutMs,
          onLine: (line) => {
            const match = /progress = *(\d+)/.exec(line);
            if (match?.[1] === undefined) return;
            lastProgress = Date.now();
            onProgress?.(Math.min(1, Number(match[1]) / 100));
          },
        }),
      ).catch((error: unknown) => {
        if (stalled) {
          throw new AppError(
            'PROCESS_FAILED',
            `o Whisper travou: ficou ${String(STALL_MS / 60_000)} min sem avançar e foi parado`,
          );
        }
        throw error;
      });
      if (Date.now() - started >= timeoutMs) {
        throw new AppError(
          'PROCESS_FAILED',
          `o Whisper passou do limite de ${String(Math.round(timeoutMs / 60_000))} min e foi parado`,
        );
      }
      if (!(await exists(target))) {
        const detail = result.stderr.trim().split(/\r?\n/).slice(-2).join(' | ');
        throw new AppError(
          'PROCESS_FAILED',
          `o Whisper não gerou a transcrição (código ${String(result.code)}): ${detail}`,
        );
      }
      onProgress?.(1);
      return JSON.parse(await fs.readFile(target, 'utf8')) as TranscriptionJson<true>;
    } finally {
      clearInterval(watchdog);
      await fs.rm(target, { force: true });
    }
  }

  private executable(): string {
    return path.join(this.paths.whisperDir, process.platform === 'win32' ? 'main.exe' : 'main');
  }
}

async function timeoutFor(audio: string): Promise<number> {
  const { size } = await fs.stat(audio);
  const seconds = size / WAV_BYTES_PER_SECOND;
  return Math.round(
    Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, seconds * SLOWEST_RATIO * 1000)),
  );
}
