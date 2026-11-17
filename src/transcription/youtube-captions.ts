import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { ProcessRunner } from '../common/process-runner.js';
import { parsePublicUrl } from '../common/safe-url.js';
import type { Word } from '../contracts/media.js';
import { YtDlp } from '../download/yt-dlp.js';
import type { Workspace } from '../workspace/workspace.js';

const MAX_WORD_MS = 1500;
const TRACK_PREFIX = 'yt-captions';

const json3Schema = z.object({
  events: z
    .array(
      z.object({
        tStartMs: z.number().optional(),
        dDurationMs: z.number().optional(),
        segs: z.array(z.object({ utf8: z.string(), tOffsetMs: z.number().optional() })).optional(),
      }),
    )
    .default([]),
});

export function parseJson3(raw: unknown): Word[] {
  const parsed = json3Schema.safeParse(raw);
  if (!parsed.success)
    throw new AppError('INVALID_INPUT', 'legenda do YouTube em formato inesperado');
  const words: Word[] = [];
  for (const event of parsed.data.events) {
    const segs = event.segs;
    if (segs === undefined || event.tStartMs === undefined) continue;
    const eventStart = event.tStartMs;
    const eventEnd = eventStart + (event.dDurationMs ?? MAX_WORD_MS);
    segs.forEach((seg, index) => {
      const text = seg.utf8.replace(/\s+/g, ' ').trim();
      if (text === '') return;
      const start = eventStart + (seg.tOffsetMs ?? 0);
      const following = segs[index + 1];
      const end = Math.min(
        following === undefined ? eventEnd : eventStart + (following.tOffsetMs ?? 0),
        start + MAX_WORD_MS * text.split(' ').length,
      );
      const pieces = text.split(' ');
      const step = Math.max(0, end - start) / pieces.length;
      pieces.forEach((piece, position) => {
        words.push({
          text: piece,
          startMs: Math.round(start + step * position),
          endMs: Math.round(start + step * (position + 1)),
        });
      });
    });
  }
  return words.sort((a, b) => a.startMs - b.startMs);
}

@Injectable()
export class YoutubeCaptions {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly ytDlp: YtDlp,
  ) {}

  async fetch(rawUrl: string, language: string, workspace: Workspace): Promise<Word[]> {
    const url = parsePublicUrl(rawUrl);
    const base = await this.ytDlp.baseArgs();
    await this.clean(workspace);
    await this.runner.exec('yt-dlp', [
      ...base,
      '--skip-download',
      '--write-auto-subs',
      '--sub-langs',
      `${language}-orig,${language}`,
      '--sub-format',
      'json3',
      '-o',
      path.join(workspace.root, `${TRACK_PREFIX}.%(ext)s`),
      '--',
      url.toString(),
    ]);
    const files = (await fs.readdir(workspace.root))
      .filter((name) => name.startsWith(`${TRACK_PREFIX}.`) && name.endsWith('.json3'))
      .sort((a, b) => Number(b.includes('-orig')) - Number(a.includes('-orig')));
    const chosen = files[0];
    if (chosen === undefined) {
      throw new AppError(
        'MISSING_FILE',
        `o vídeo não tem legenda automática em ${language}: use cortes-eb transcribe`,
      );
    }
    try {
      const text = await fs.readFile(path.join(workspace.root, chosen), 'utf8');
      return parseJson3(JSON.parse(text));
    } finally {
      await this.clean(workspace);
    }
  }

  private async clean(workspace: Workspace): Promise<void> {
    const names = await fs.readdir(workspace.root).catch(() => []);
    await Promise.all(
      names
        .filter((name) => name.startsWith(`${TRACK_PREFIX}.`))
        .map((name) => fs.rm(path.join(workspace.root, name), { force: true })),
    );
  }
}
