import fs from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { Output } from '../common/output.js';
import { UserConfigStore, type UserConfig } from '../config/user-config.js';
import { captionsSchema, silencesSchema, type Word } from '../contracts/media.js';
import { MediaTools } from '../media/media-tools.js';
import { transcriptLines } from '../timeline/captions.js';
import type { Workspace } from '../workspace/workspace.js';
import { dropMarkers } from './tokens.js';
import { Whisper } from './whisper.js';

export interface TranscriptionSummary {
  words: number;
  silences: number;
  duration: number;
  language: string;
  model: string;
}

export interface TranscriptionRequest {
  language?: string;
  maxSeconds?: number;
  from?: number;
  to?: number;
}

const PROGRESS_STEP = 0.1;

@Injectable()
export class TranscriptionService {
  constructor(
    private readonly media: MediaTools,
    private readonly whisper: Whisper,
    private readonly config: UserConfigStore,
    private readonly output: Output,
  ) {}

  async run(workspace: Workspace, request: TranscriptionRequest): Promise<TranscriptionSummary> {
    const source = workspace.video('source');
    if (!(await exists(source))) {
      throw new AppError('MISSING_FILE', 'falta o source.mp4 na pasta de trabalho');
    }
    const config = await this.config.load();
    const language = request.language ?? config.language;
    const meta = await this.media.probe(source);
    if (request.from !== undefined || request.to !== undefined) {
      const words = await this.redo(
        workspace,
        request,
        meta.duration,
        config.whisperModel,
        language,
      );
      const silences = await readJson(workspace.silences, silencesSchema);
      return this.summary(words.length, silences.length, meta.duration, language, config);
    }
    await writeJson(workspace.meta, meta);
    await this.media.extractAudio(source, workspace.audio, request.maxSeconds);
    const audible = Math.min(meta.duration, request.maxSeconds ?? meta.duration);
    const silences = await this.media.detectSilences(workspace.audio, audible);
    await writeJson(workspace.silences, silences);
    const words = await this.whisper.transcribe(
      workspace.audio,
      config.whisperModel,
      language,
      this.progress(),
    );
    await writeJson(workspace.captions, words);
    return this.summary(words.length, silences.length, meta.duration, language, config);
  }

  private async redo(
    workspace: Workspace,
    request: TranscriptionRequest,
    duration: number,
    model: UserConfig['whisperModel'],
    language: string,
  ): Promise<Word[]> {
    const from = Math.max(0, request.from ?? 0);
    const to = Math.min(duration, request.to ?? duration);
    if (to <= from)
      throw new AppError('INVALID_INPUT', 'o trecho precisa ter --to maior que --from');
    const current = await readJson(workspace.captions, captionsSchema);
    const range = workspace.file('audio-range.wav');
    await this.media.extractAudio(workspace.video('source'), range, to - from, from);
    const fresh = await this.whisper.transcribe(range, model, language, this.progress());
    await fs.rm(range, { force: true });
    const offset = Math.round(from * 1000);
    const shifted = fresh.map((word) => ({
      text: word.text,
      startMs: word.startMs + offset,
      endMs: word.endMs + offset,
    }));
    const kept = current.filter((word) => word.startMs < offset || word.startMs >= to * 1000);
    const merged = [...kept, ...shifted].sort((a, b) => a.startMs - b.startMs);
    await writeJson(workspace.captions, merged);
    return merged;
  }

  private progress(): (fraction: number) => void {
    let reported = 0;
    return (fraction) => {
      if (fraction < reported + PROGRESS_STEP && fraction < 1) return;
      reported = fraction;
      this.output.info(`> transcrevendo ${Math.round(fraction * 100)}%`);
    };
  }

  private summary(
    words: number,
    silences: number,
    duration: number,
    language: string,
    config: UserConfig,
  ): TranscriptionSummary {
    return { words, silences, duration, language, model: config.whisperModel };
  }

  async lines(workspace: Workspace): Promise<string[]> {
    return transcriptLines(dropMarkers(await readJson(workspace.captions, captionsSchema)));
  }
}
