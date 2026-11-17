import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Injectable } from '@nestjs/common';
import { writeJson } from '../common/json-file.js';
import { resolveInside } from '../common/safe-path.js';
import { AppPaths } from '../config/app-paths.js';
import type { Job, Platform } from '../contracts/publish.js';
import { PublishError, type Publisher, type PublishResult } from './publisher.js';

@Injectable()
export class OutboxPublisher {
  constructor(private readonly paths: AppPaths) {}

  for(platform: Platform): Publisher {
    return { platform, publish: (job) => this.publish(job) };
  }

  async publish(job: Job): Promise<PublishResult> {
    const folder = resolveInside(resolveInside(this.paths.outboxDir, job.platform), job.account);
    await fs.mkdir(folder, { recursive: true });
    const video = resolveInside(folder, `${job.id}.mp4`);
    try {
      await fs.copyFile(job.file, video);
    } catch {
      throw new PublishError(`não consegui copiar ${path.basename(job.file)}`, false);
    }
    await writeJson(resolveInside(folder, `${job.id}.json`), {
      id: job.id,
      platform: job.platform,
      account: job.account,
      title: job.title,
      description: job.description,
      tags: job.tags,
    });
    return { url: pathToFileURL(video).toString() };
  }
}
