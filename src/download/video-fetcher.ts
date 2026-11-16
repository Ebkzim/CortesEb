import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { ProcessRunner } from '../common/process-runner.js';
import { parsePublicUrl } from '../common/safe-url.js';
import { MediaTools } from '../media/media-tools.js';
import type { VideoRole, Workspace } from '../workspace/workspace.js';

const MAX_HEIGHT: Record<VideoRole, number> = { source: 1080, bottom: 720 };
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi']);

@Injectable()
export class VideoFetcher {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly media: MediaTools,
  ) {}

  async fetch(input: string, role: VideoRole, workspace: Workspace): Promise<string> {
    await workspace.ensure();
    const target = workspace.video(role);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
      await this.download(input, role, workspace);
    } else {
      await this.importFile(input, target);
    }
    await this.media.probe(target);
    return target;
  }

  private async download(raw: string, role: VideoRole, workspace: Workspace): Promise<void> {
    const url = parsePublicUrl(raw);
    if (!(await this.runner.has('yt-dlp'))) {
      throw new AppError('MISSING_DEPENDENCY', 'yt-dlp não está instalado: envie um arquivo');
    }
    await fs.rm(workspace.video(role), { force: true });
    await this.runner.exec(
      'yt-dlp',
      [
        '--ignore-config',
        '--no-playlist',
        '--no-exec',
        '--no-cookies-from-browser',
        '--restrict-filenames',
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
      { stream: true },
    );
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
