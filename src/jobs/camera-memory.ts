import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import { percentRectSchema, type JobRequest, type PercentRect } from '../contracts/job.js';

const memorySchema = z.record(z.string().max(120), percentRectSchema);
const MAX_ENTRIES = 200;

@Injectable()
export class CameraMemory {
  constructor(private readonly paths: AppPaths) {}

  private get file(): string {
    return path.join(this.paths.home, 'cameras.json');
  }

  async recall(request: JobRequest, fallback: PercentRect): Promise<PercentRect> {
    const memory = await this.load();
    return memory[keyOf(request)] ?? fallback;
  }

  async remember(request: JobRequest, rect: PercentRect): Promise<void> {
    const memory = await this.load();
    const key = keyOf(request);
    const entries = [
      ...Object.entries(memory).filter(([name]) => name !== key),
      [key, rect] as const,
    ].slice(-MAX_ENTRIES);
    await writeJson(this.file, Object.fromEntries(entries)).catch(() => undefined);
  }

  private async load(): Promise<Record<string, PercentRect>> {
    if (!(await exists(this.file))) return {};
    return readJson(this.file, memorySchema).catch(() => ({}));
  }
}

function keyOf(request: JobRequest): string {
  return `${request.preset}:${request.accounts?.[0] ?? '-'}`;
}
