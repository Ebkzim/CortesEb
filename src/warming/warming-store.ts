import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { withFileLock } from '../common/file-lock.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import { warmingFileSchema, type WarmingSession } from './warming-state.js';

@Injectable()
export class WarmingStore {
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private readonly paths: AppPaths) {}
  private get file(): string {
    return path.join(this.paths.home, 'warming.json');
  }

  async list(): Promise<WarmingSession[]> {
    if (!(await exists(this.file))) return [];
    return (await readJson(this.file, warmingFileSchema)).sessions;
  }

  update<T>(work: (sessions: WarmingSession[]) => T): Promise<T> {
    const run = this.lock.then(() =>
      withFileLock(`${this.file}.lock`, async () => {
        const sessions = await this.list();
        const result = work(sessions);
        await writeJson(this.file, warmingFileSchema.parse({ sessions }), 0o600);
        return result;
      }),
    );
    this.lock = run.catch(() => undefined);
    return run;
  }
}
