import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { exists } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';

export const SFX_NAMES = ['impact', 'whoosh', 'pop'] as const;
export type SfxName = (typeof SFX_NAMES)[number];

const ALIASES: Record<SfxName, readonly string[]> = {
  impact: ['impact', 'impacto'],
  whoosh: ['whoosh'],
  pop: ['pop'],
};
const EXTENSIONS = ['.mp3', '.wav'] as const;

@Injectable()
export class SfxLibrary {
  constructor(private readonly paths: AppPaths) {}

  async locate(name: SfxName): Promise<string | null> {
    for (const alias of ALIASES[name]) {
      for (const extension of EXTENSIONS) {
        const candidate = path.join(this.paths.sfxDir, alias + extension);
        if (await exists(candidate)) return candidate;
      }
    }
    return null;
  }

  async count(): Promise<number> {
    const found = await Promise.all(SFX_NAMES.map((name) => this.locate(name)));
    return found.filter((file) => file !== null).length;
  }

  target(name: SfxName): string {
    return path.join(this.paths.sfxDir, `${name}.mp3`);
  }

  async ensureFolder(): Promise<void> {
    await fs.mkdir(this.paths.sfxDir, { recursive: true });
  }
}
