import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppPaths } from '../config/app-paths.js';
import { cleanHashtags } from '../contracts/cuts.js';
import { JobRepository } from '../database/job.repository.js';

export interface PostText {
  title: string;
  description: string | null;
  hashtags: string[];
}

export interface PostTextLookup {
  find(file: string): Promise<PostText | null>;
}

@Injectable()
export class LibraryPostText implements PostTextLookup {
  constructor(
    private readonly paths: AppPaths,
    private readonly jobs: JobRepository,
  ) {}

  async find(file: string): Promise<PostText | null> {
    const relative = path.relative(this.paths.libraryDir, path.resolve(file));
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const row = await this.jobs.clipByFile(relative).catch(() => null);
    if (row === null) return null;
    return {
      title: row.title,
      description: row.description,
      hashtags: cleanHashtags(Array.isArray(row.hashtags) ? row.hashtags : []),
    };
  }
}
