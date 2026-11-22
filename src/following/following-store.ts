import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { withFileLock } from '../common/file-lock.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import { followingFileSchema, type FollowingSession } from './following-state.js';

@Injectable()
export class FollowingStore {
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private readonly paths: AppPaths) {}
  private get file(): string {
    return path.join(this.paths.home, 'following.json');
  }
  async list(): Promise<FollowingSession[]> {
    if (!(await exists(this.file))) return [];
    return (await readJson(this.file, followingFileSchema)).sessions;
  }
  update<T>(work: (sessions: FollowingSession[]) => T): Promise<T> {
    const run = this.lock.then(() =>
      withFileLock(`${this.file}.lock`, async () => {
        const sessions = await this.list();
        const result = work(sessions);
        await writeJson(this.file, followingFileSchema.parse({ sessions }), 0o600);
        return result;
      }),
    );
    this.lock = run.catch(() => undefined);
    return run;
  }
}
