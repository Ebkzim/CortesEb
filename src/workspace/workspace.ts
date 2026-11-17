import fs from 'node:fs/promises';
import path from 'node:path';
import { assertPlainName, resolveInside } from '../common/safe-path.js';

export type VideoRole = 'source' | 'bottom';

export class Workspace {
  readonly root: string;

  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  get audio(): string {
    return this.file('audio16k.wav');
  }

  get captions(): string {
    return this.file('captions.json');
  }

  get silences(): string {
    return this.file('silences.json');
  }

  get meta(): string {
    return this.file('meta.json');
  }

  get origin(): string {
    return this.file('origin.json');
  }

  get cuts(): string {
    return this.file('cuts.json');
  }

  get imagesDir(): string {
    return this.file('imgs');
  }

  video(role: VideoRole): string {
    return this.file(`${role}.mp4`);
  }

  file(name: string): string {
    return resolveInside(this.root, assertPlainName(name));
  }

  async ensure(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }
}
