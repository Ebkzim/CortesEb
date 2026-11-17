import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { writeJson } from '../common/json-file.js';
import { ProcessRunner } from '../common/process-runner.js';
import { parsePublicUrl } from '../common/safe-url.js';
import { MediaTools } from '../media/media-tools.js';
import type { VideoRole, Workspace } from '../workspace/workspace.js';
import { Progress, throttled } from '../common/progress.js';
import { DownloadTracker, downloadPercent, YtDlp } from './yt-dlp.js';

const MAX_HEIGHT: Record<VideoRole, number> = { source: 1080, bottom: 720 };
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi']);

export interface Section {
  from: number;
  to: number;
}

const MAX_SECTION_SECONDS = 6 * 3600;

export function sectionArgs(section: Section | undefined): string[] {
  if (section === undefined) return [];
  if (!(section.from >= 0) || !(section.to > section.from)) {
    throw new AppError('INVALID_INPUT', 'o trecho precisa ter --to maior que --from');
  }
  if (section.to - section.from > MAX_SECTION_SECONDS) {
    throw new AppError('INVALID_INPUT', 'o trecho passa de 6 horas');
  }
  return ['--download-sections', `*${Math.floor(section.from)}-${Math.ceil(section.to)}`];
}

@Injectable()
export class VideoFetcher {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly media: MediaTools,
    private readonly ytDlp: YtDlp,
    private readonly progress: Progress,
  ) {}

  async fetch(
    input: string,
    role: VideoRole,
    workspace: Workspace,
    section?: Section,
  ): Promise<string> {
    await workspace.ensure();
    const target = workspace.video(role);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
      await this.download(input, role, workspace, section);
    } else {
      if (section !== undefined) {
        throw new AppError('INVALID_INPUT', 'trecho (--from/--to) só vale para links');
      }
      await this.importFile(input, target);
    }
    await this.media.probe(target);
    return target;
  }

  private async download(
    raw: string,
    role: VideoRole,
    workspace: Workspace,
    section?: Section,
  ): Promise<void> {
    const url = parsePublicUrl(raw);
    const base = await this.ytDlp.baseArgs(this.progress.active);
    await fs.rm(workspace.video(role), { force: true });
    const step = role === 'source' ? 'download' : 'bottom';
    const tracker = new DownloadTracker(section === undefined ? 2 : 1);
    const report = throttled((fraction: number) => {
      this.progress.step(step, fraction, `baixando ${Math.round(fraction * 100)}%`);
    });
    this.progress.step(step, 0, 'iniciando o download');
    await this.runner.exec(
      'yt-dlp',
      [
        ...base,
        ...sectionArgs(section),
        '-S',
        `res:${MAX_HEIGHT[role]}`,
        '-f',
        'bv*+ba/b',
        '--merge-output-format',
        'mp4',
        '-o',
        path.join(workspace.root, `${role}.%(ext)s`),
        '--',
        url.toString(),
      ],
      {
        stream: true,
        ...(this.progress.active
          ? {
              onLine: (line: string) => {
                const percent = downloadPercent(line);
                if (percent !== null) report(tracker.update(percent));
              },
            }
          : {}),
      },
    );
    if (role === 'source') {
      await writeJson(workspace.origin, { url: url.toString(), offset: section?.from ?? 0 });
    }
  }

  private async importFile(input: string, target: string): Promise<void> {
    const source = path.resolve(input);
    const extension = path.extname(source).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(extension)) {
      throw new AppError('INVALID_INPUT', `formato de vídeo não aceito: ${extension || 'nenhum'}`);
    }
    const stat = await fs.stat(source).catch(() => null);
    if (stat === null || !stat.isFile()) {
      throw new AppError('MISSING_FILE', `não achei o vídeo ${source}`);
    }
    if (source === target) return;
    if (extension === '.mp4') {
      await fs.copyFile(source, target);
      return;
    }
    await this.media.toMp4(source, target);
  }
}
