import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { exists, writeJson } from '../common/json-file.js';
import { MediaTools } from '../media/media-tools.js';
import type { Workspace } from '../workspace/workspace.js';
import { PEAK_DEFAULTS, findPeakWindows, type PeakOptions, type PeakWindow } from './loudness.js';

export const peaksFileSchema = z.strictObject({
  windows: z.array(
    z.strictObject({
      start: z.number().nonnegative(),
      end: z.number().positive(),
      peakAt: z.number().nonnegative(),
      score: z.number(),
    }),
  ),
});

export interface PeaksResult {
  seconds: number;
  windows: (PeakWindow & { clock: string })[];
}

@Injectable()
export class PeaksService {
  constructor(private readonly media: MediaTools) {}

  async scan(workspace: Workspace, options: Partial<PeakOptions>): Promise<PeaksResult> {
    const source = workspace.video('source');
    if (!(await exists(source))) {
      throw new AppError('MISSING_FILE', 'falta o source.mp4 na pasta de trabalho');
    }
    const levels = await this.media.rmsLevels(source);
    const windows = findPeakWindows(levels, { ...PEAK_DEFAULTS, ...options });
    await writeJson(workspace.file('peaks.json'), { windows });
    return {
      seconds: levels.length,
      windows: windows.map((window) => ({
        ...window,
        clock: `${clock(window.start)}-${clock(window.end)}`,
      })),
    };
  }
}

function clock(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${secs}` : `${minutes}:${secs}`;
}
