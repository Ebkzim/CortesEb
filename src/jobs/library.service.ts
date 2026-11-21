import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { resolveInside } from '../common/safe-path.js';
import { AppPaths } from '../config/app-paths.js';
import { JobRepository, type ClipRow } from '../database/job.repository.js';
import { MediaTools } from '../media/media-tools.js';
import { slug } from '../select/candidates.js';

export interface LibraryInput {
  jobId: string;
  jobTitle: string;
  file: string;
  clipId: string;
  title: string;
  hook: string | null;
  description: string | null;
  hashtags: string[];
  score: number | null;
  account: string | null;
}

const THUMB_WIDTH = 360;
const THUMB_AT_SECONDS = 1;

export function localDay(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function folderName(jobTitle: string, jobId: string): string {
  return `${slug(jobTitle)}-${jobId.slice(0, 8)}`;
}

@Injectable()
export class LibraryService {
  constructor(
    private readonly paths: AppPaths,
    private readonly jobs: JobRepository,
    private readonly media: MediaTools,
  ) {}

  async add(input: LibraryInput, now = new Date()): Promise<ClipRow> {
    const day = localDay(now);
    const folder = path.join(day, folderName(input.jobTitle, input.jobId));
    const absoluteFolder = resolveInside(this.paths.libraryDir, folder);
    await fs.mkdir(absoluteFolder, { recursive: true });
    const base =
      input.account === null ? slug(input.clipId) : `${slug(input.clipId)}-${slug(input.account)}`;
    const name = await this.freeName(absoluteFolder, base);
    const target = path.join(absoluteFolder, `${name}.mp4`);
    await move(input.file, target);
    const thumbName = `${name}.jpg`;
    const thumb = await this.media
      .frame(target, THUMB_AT_SECONDS, path.join(absoluteFolder, thumbName), THUMB_WIDTH)
      .then(() => path.join(folder, thumbName))
      .catch(() => null);
    const seconds = await this.media.duration(target).catch(() => 0);
    const size = (await fs.stat(target)).size;
    return this.jobs.addClip({
      jobId: input.jobId,
      day,
      title: input.title.slice(0, 200),
      hook: input.hook?.slice(0, 500) ?? null,
      description: input.description?.slice(0, 2200) ?? null,
      hashtags: input.hashtags.slice(0, 15),
      score: input.score,
      seconds: Number(seconds.toFixed(2)),
      file: path.join(folder, `${name}.mp4`),
      thumb,
      sizeBytes: size,
      account: input.account,
    });
  }

  absolute(relative: string): string {
    return resolveInside(this.paths.libraryDir, relative);
  }

  async remove(clipId: string): Promise<void> {
    const clip = await this.jobs.removeClip(clipId);
    for (const relative of [clip.file, clip.thumb]) {
      if (relative === null) continue;
      await fs.rm(this.absolute(relative), { force: true });
    }
  }

  private async freeName(folder: string, base: string): Promise<string> {
    for (let index = 0; index < 1000; index += 1) {
      const candidate = index === 0 ? base : `${base}-${String(index + 1)}`;
      const taken = await fs
        .access(path.join(folder, `${candidate}.mp4`))
        .then(() => true)
        .catch(() => false);
      if (!taken) return candidate;
    }
    return `${base}-${String(Date.now())}`;
  }
}

async function move(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch {
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}
