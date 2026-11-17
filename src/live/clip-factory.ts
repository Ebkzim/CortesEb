import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { readJson, writeJson } from '../common/json-file.js';
import { ProcessRunner } from '../common/process-runner.js';
import { resolveInside } from '../common/safe-path.js';
import { captionsSchema, sourceMetaSchema } from '../contracts/media.js';
import type { UserConfig } from '../config/user-config.js';
import { RenderService, type ClipResult } from '../render/render.service.js';
import { TranscriptionService } from '../transcription/transcription.service.js';
import { Workspace } from '../workspace/workspace.js';
import { buildLiveClip } from './clip-cut.js';
import type { LiveWindow } from './live-detector.js';
import type { Segment } from './segment-log.js';

export interface PreparedClip {
  id: string;
  dir: string;
  offset: number;
  window: LiveWindow;
  emittedAt: number;
  emittedStream: number;
}

export interface FactoryOptions {
  outDir: string;
  accounts: string[] | undefined;
  language: string | undefined;
  model: UserConfig['whisperModel'] | undefined;
  hasBottom: boolean;
  minWords: number;
  keepWork: boolean;
}

export type Produced =
  | { ok: true; id: string; results: ClipResult[]; hook: string | null; afterPeakSeconds: number }
  | { ok: false; id: string; reason: string };

const PAD_SECONDS = 1;

@Injectable()
export class ClipFactory {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly transcription: TranscriptionService,
    private readonly renderer: RenderService,
  ) {}

  async prepare(
    id: string,
    window: LiveWindow,
    segments: readonly Segment[],
    recordingDir: string,
    workRoot: string,
    bottomFile: string | null,
    stamp: { emittedAt: number; emittedStream: number },
  ): Promise<PreparedClip> {
    const chosen = segments.filter(
      (segment) =>
        segment.end > window.start - PAD_SECONDS && segment.start < window.end + PAD_SECONDS,
    );
    const first = chosen[0];
    if (first === undefined) {
      throw new AppError('MISSING_FILE', 'os pedaços da live desse momento já foram apagados');
    }
    const dir = resolveInside(workRoot, id);
    const workspace = new Workspace(dir);
    await workspace.ensure();
    const list = path.join(dir, 'parts.txt');
    await fs.writeFile(
      list,
      chosen
        .map((segment) => `file '${quoted(resolveInside(recordingDir, segment.file))}'\n`)
        .join(''),
    );
    await this.runner.exec('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-nostdin',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-c',
      'copy',
      workspace.video('source'),
    ]);
    await fs.rm(list, { force: true });
    if (bottomFile !== null) await link(bottomFile, workspace.video('bottom'));
    return { id, dir, offset: first.start, window, ...stamp };
  }

  async produce(job: PreparedClip, options: FactoryOptions): Promise<Produced> {
    const workspace = new Workspace(job.dir);
    await this.transcription.run(workspace, {
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.model === undefined ? {} : { model: options.model }),
    });
    const outcome = buildLiveClip({
      id: job.id,
      window: job.window,
      offset: job.offset,
      duration: (await readJson(workspace.meta, sourceMetaSchema)).duration,
      words: await readJson(workspace.captions, captionsSchema),
      bottom: options.hasBottom ? 'video' : 'source',
      minWords: options.minWords,
    });
    if (!outcome.ok) {
      await this.discard(job, options);
      return { ok: false, id: job.id, reason: outcome.reason };
    }
    await writeJson(workspace.cuts, { clips: [outcome.clip] });
    const results = await this.renderer.run(workspace, options.outDir, options.accounts, 'fast');
    const afterPeak = job.emittedStream - job.window.peakAt + (Date.now() - job.emittedAt) / 1000;
    await this.discard(job, options);
    return {
      ok: true,
      id: job.id,
      results,
      hook: outcome.clip.hook ?? null,
      afterPeakSeconds: Number(afterPeak.toFixed(1)),
    };
  }

  private async discard(job: PreparedClip, options: FactoryOptions): Promise<void> {
    if (options.keepWork) return;
    await fs.rm(job.dir, { recursive: true, force: true });
  }
}

function quoted(file: string): string {
  if (/['\n\r]/.test(file)) throw new AppError('UNSAFE_PATH', 'nome de pedaço inválido');
  return file;
}

async function link(source: string, target: string): Promise<void> {
  await fs.rm(target, { force: true });
  try {
    await fs.link(source, target);
  } catch {
    await fs.copyFile(source, target);
  }
}
