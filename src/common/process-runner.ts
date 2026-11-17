import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from './app-error.js';

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  stream?: boolean;
  onLine?: (line: string) => void;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const STDERR_FD = 2;
const MAX_LINE_CHARS = 8192;

@Injectable()
export class ProcessRunner {
  run(bin: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, [...args], {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        stdio:
          options.stream === true && options.onLine === undefined
            ? ['ignore', STDERR_FD, STDERR_FD]
            : 'pipe',
      });
      const stdout = new Capture();
      const stderr = new Capture();
      const outLines = options.onLine === undefined ? null : new LineSplitter(options.onLine);
      const errLines = options.onLine === undefined ? null : new LineSplitter(options.onLine);
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout.push(chunk);
        outLines?.push(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr.push(chunk);
        errLines?.push(chunk);
      });
      child.stdin?.end();
      child.on('error', () => {
        reject(new AppError('MISSING_DEPENDENCY', `não consegui executar ${bin}`));
      });
      child.on('close', (code) => {
        outLines?.flush();
        errLines?.flush();
        resolve({ code: code ?? 1, stdout: stdout.text(), stderr: stderr.text() });
      });
    });
  }

  start(bin: string, args: readonly string[]): ChildProcessByStdio<null, null, Readable> {
    const child = spawn(bin, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.on('error', () => undefined);
    return child;
  }

  async exec(bin: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    const result = await this.run(bin, args, options);
    if (result.code !== 0) {
      const detail = result.stderr.trim().split(/\r?\n/).slice(-3).join(' | ');
      throw new AppError('PROCESS_FAILED', `${bin} saiu com código ${result.code}: ${detail}`);
    }
    return result;
  }

  async has(bin: string): Promise<boolean> {
    return (await this.locate(bin)) !== null;
  }

  async locate(bin: string): Promise<string | null> {
    const folders = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
    for (const folder of folders) {
      for (const suffix of suffixes) {
        const candidate = path.join(folder, bin + suffix);
        try {
          await fs.access(candidate, constants.X_OK);
          return candidate;
        } catch {
          continue;
        }
      }
    }
    return null;
  }
}

class Capture {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  push(chunk: Buffer): void {
    if (this.size >= MAX_CAPTURE_BYTES) return;
    this.chunks.push(chunk);
    this.size += chunk.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

class LineSplitter {
  private pending = '';

  constructor(private readonly onLine: (line: string) => void) {}

  flush(): void {
    if (this.pending !== '') this.onLine(this.pending);
    this.pending = '';
  }

  push(chunk: Buffer): void {
    const parts = (this.pending + chunk.toString('utf8')).split(/\r\n|\r|\n/);
    this.pending = (parts.pop() ?? '').slice(-MAX_LINE_CHARS);
    for (const part of parts) {
      if (part !== '') this.onLine(part);
    }
  }
}
