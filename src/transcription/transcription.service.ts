import fs from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { Output } from '../common/output.js';
import { UserConfigStore, type UserConfig } from '../config/user-config.js';
import { cutsSchema } from '../contracts/cuts.js';
import { captionsSchema, silencesSchema, sourceMetaSchema } from '../contracts/media.js';
import { originSchema } from '../contracts/origin.js';
import { MediaTools } from '../media/media-tools.js';
import { transcriptLines } from '../timeline/captions.js';
import type { Workspace } from '../workspace/workspace.js';
import { dropLoops, dropMarkers } from './tokens.js';
import { Whisper } from './whisper.js';
import { YoutubeCaptions } from './youtube-captions.js';

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
  model?: UserConfig['whisperModel'];
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
    private readonly youtube: YoutubeCaptions,
  ) {}

  async run(workspace: Workspace, request: TranscriptionRequest): Promise<TranscriptionSummary> {
    const source = workspace.video('source');
    if (!(await exists(source))) {
      throw new AppError('MISSING_FILE', 'falta o source.mp4 na pasta de trabalho');
    }
    const config = await this.config.load();
    const language = request.language ?? config.language;
    const model = request.model ?? config.whisperModel;
    const meta = await this.media.probe(source);
    if (request.from !== undefined || request.to !== undefined) {
      await writeJson(workspace.meta, meta);
      const result = await this.redo(workspace, request, meta.duration, model, language);
      return this.summary(result.words, result.silences, meta.duration, language, model);
    }
    await writeJson(workspace.meta, meta);
    await this.media.extractAudio(source, workspace.audio, request.maxSeconds);
    const audible = Math.min(meta.duration, request.maxSeconds ?? meta.duration);
    const silences = await this.media.detectSilences(workspace.audio, audible);
    await writeJson(workspace.silences, silences);
    const words = await this.whisper.transcribe(workspace.audio, model, language, this.progress());
    await writeJson(workspace.captions, words);
    return this.summary(words.length, silences.length, meta.duration, language, model);
  }

  async fromYoutube(
    workspace: Workspace,
    language: string | undefined,
    url: string | undefined,
  ): Promise<TranscriptionSummary> {
    const source = workspace.video('source');
    if (!(await exists(source))) {
      throw new AppError('MISSING_FILE', 'falta o source.mp4 na pasta de trabalho');
    }
    const config = await this.config.load();
    const lang = language ?? config.language;
    if (lang === 'auto') {
      throw new AppError(
        'INVALID_INPUT',
        'a legenda do YouTube precisa de um idioma, ex.: --lang pt',
      );
    }
    const link = url ?? (await readJson(workspace.origin, originSchema).catch(() => null))?.url;
    if (link === undefined) {
      throw new AppError('INVALID_INPUT', 'sem link de origem: use --url ou baixe com fetch');
    }
    const words = dropLoops(dropMarkers(await this.youtube.fetch(link, lang, workspace)));
    const meta = await this.media.probe(source);
    await writeJson(workspace.meta, meta);
    await this.media.extractAudio(source, workspace.audio);
    const silences = await this.media.detectSilences(workspace.audio, meta.duration);
    await writeJson(workspace.silences, silences);
    await writeJson(workspace.captions, words);
    return this.summary(words.length, silences.length, meta.duration, lang, config.whisperModel);
  }

  async refine(workspace: Workspace, pad: number): Promise<{ ranges: number[][]; words: number }> {
    const cuts = await readJson(workspace.cuts, cutsSchema);
    const meta = await readJson(workspace.meta, sourceMetaSchema);
    const config = await this.config.load();
    const ranges = mergeRanges(
      cuts.clips.map((clip) => [
        Math.max(0, clip.start - pad),
        Math.min(meta.duration, clip.end + pad),
      ]),
    );
    let words = 0;
    for (const [from, to] of ranges) {
      if (from === undefined || to === undefined) continue;
      this.output.info(`> refinando ${from.toFixed(0)}s a ${to.toFixed(0)}s`);
      words = (
        await this.redo(
          workspace,
          { from, to },
          meta.duration,
          config.whisperModel,
          config.language,
        )
      ).words;
    }
    return { ranges, words };
  }

  private async redo(
    workspace: Workspace,
    request: TranscriptionRequest,
    duration: number,
    model: UserConfig['whisperModel'],
    language: string,
  ): Promise<{ words: number; silences: number }> {
    const from = Math.max(0, request.from ?? 0);
    const to = Math.min(duration, request.to ?? duration);
    if (to <= from)
      throw new AppError('INVALID_INPUT', 'o trecho precisa ter --to maior que --from');
    const current = (await exists(workspace.captions))
      ? await readJson(workspace.captions, captionsSchema)
      : [];
    const currentSilences = (await exists(workspace.silences))
      ? await readJson(workspace.silences, silencesSchema)
      : [];
    const range = workspace.file('audio-range.wav');
    await this.media.extractAudio(workspace.video('source'), range, to - from, from);
    const found = await this.media.detectSilences(range, to - from);
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
    const silences = [
      ...currentSilences.filter((item) => item.end <= from || item.start >= to),
      ...found.map((item) => ({ start: item.start + from, end: item.end + from })),
    ].sort((a, b) => a.start - b.start);
    await writeJson(workspace.captions, merged);
    await writeJson(workspace.silences, silences);
    return { words: merged.length, silences: silences.length };
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
    model: string,
  ): TranscriptionSummary {
    return { words, silences, duration, language, model };
  }

  async lines(workspace: Workspace): Promise<string[]> {
    return transcriptLines(dropMarkers(await readJson(workspace.captions, captionsSchema)));
  }
}

function mergeRanges(ranges: number[][]): number[][] {
  const ordered = [...ranges].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  const merged: number[][] = [];
  for (const range of ordered) {
    const last = merged[merged.length - 1];
    const [from, to] = range;
    if (from === undefined || to === undefined) continue;
    if (last !== undefined && from <= (last[1] ?? 0)) {
      last[1] = Math.max(last[1] ?? 0, to);
    } else {
      merged.push([from, to]);
    }
  }
  return merged;
}
