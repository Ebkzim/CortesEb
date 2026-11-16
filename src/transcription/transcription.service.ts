import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { UserConfigStore } from '../config/user-config.js';
import { captionsSchema } from '../contracts/media.js';
import { MediaTools } from '../media/media-tools.js';
import { transcriptLines } from '../timeline/captions.js';
import type { Workspace } from '../workspace/workspace.js';
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
}

@Injectable()
export class TranscriptionService {
  constructor(
    private readonly media: MediaTools,
    private readonly whisper: Whisper,
    private readonly config: UserConfigStore,
  ) {}

  async run(workspace: Workspace, request: TranscriptionRequest): Promise<TranscriptionSummary> {
    const source = workspace.video('source');
    if (!(await exists(source))) {
      throw new AppError('MISSING_FILE', 'falta o source.mp4 na pasta de trabalho');
    }
    const config = await this.config.load();
    const language = request.language ?? config.language;
    const meta = await this.media.probe(source);
    await writeJson(workspace.meta, meta);
    await this.media.extractAudio(source, workspace.audio, request.maxSeconds);
    const audible = Math.min(meta.duration, request.maxSeconds ?? meta.duration);
    const silences = await this.media.detectSilences(workspace.audio, audible);
    await writeJson(workspace.silences, silences);
    const words = await this.whisper.transcribe(workspace.audio, config.whisperModel, language);
    await writeJson(workspace.captions, words);
    return {
      words: words.length,
      silences: silences.length,
      duration: meta.duration,
      language,
      model: config.whisperModel,
    };
  }

  async lines(workspace: Workspace): Promise<string[]> {
    return transcriptLines(await readJson(workspace.captions, captionsSchema));
  }
}
