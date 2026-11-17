import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { ProcessRunner } from '../common/process-runner.js';

const JS_RUNTIMES_FLAG = '--js-runtimes';
const HELP_TIMEOUT_MS = 30_000;
const PROGRESS_ARGS = [
  '--newline',
  '--progress-template',
  'download:[cortes] %(progress._percent_str)s',
];
const PERCENT = /\[cortes\]\s*([0-9.]+)%/;

export function downloadPercent(line: string): number | null {
  const match = PERCENT.exec(line);
  if (match?.[1] === undefined) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export class DownloadTracker {
  private phase = 0;
  private last = 0;
  private best = 0;

  constructor(private readonly phases: number) {}

  update(percent: number): number {
    if (percent + 20 < this.last) this.phase = Math.min(this.phases - 1, this.phase + 1);
    this.last = percent;
    const overall = (this.phase + percent / 100) / this.phases;
    this.best = Math.max(this.best, Math.min(1, overall));
    return this.best;
  }
}

@Injectable()
export class YtDlp {
  constructor(private readonly runner: ProcessRunner) {}

  async baseArgs(progress = false): Promise<string[]> {
    if (!(await this.runner.has('yt-dlp'))) {
      throw new AppError('MISSING_DEPENDENCY', 'yt-dlp não está instalado: envie um arquivo');
    }
    const help = await this.runner.run('yt-dlp', ['--help'], { timeoutMs: HELP_TIMEOUT_MS });
    const runtime = help.stdout.includes(JS_RUNTIMES_FLAG)
      ? [JS_RUNTIMES_FLAG, `node:${process.execPath}`]
      : [];
    return [
      ...runtime,
      '--ignore-config',
      '--no-playlist',
      '--no-exec',
      '--no-cookies-from-browser',
      ...(progress ? PROGRESS_ARGS : ['--no-progress']),
      '--restrict-filenames',
    ];
  }
}
