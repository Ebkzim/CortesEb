import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { ProcessRunner } from '../common/process-runner.js';

const JS_RUNTIMES_FLAG = '--js-runtimes';
const HELP_TIMEOUT_MS = 30_000;

@Injectable()
export class YtDlp {
  constructor(private readonly runner: ProcessRunner) {}

  async baseArgs(): Promise<string[]> {
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
      '--no-progress',
      '--restrict-filenames',
    ];
  }
}
