import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentSignal } from '../common/cancellation.js';
import type { ProcessRunner, RunOptions } from '../common/process-runner.js';
import type { AppPaths } from '../config/app-paths.js';
import { Whisper } from './whisper.js';

const OUTPUT = {
  transcription: [
    {
      offsets: { from: 0, to: 600 },
      text: ' Olá',
      tokens: [{ text: ' Olá', offsets: { from: 0, to: 600 }, t_dtw: 10, id: 1, p: 0.9 }],
      timestamps: { from: '00:00:00,000', to: '00:00:00,600' },
    },
  ],
};

describe('Whisper', () => {
  let dir = '';
  let audio = '';

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-whisper-'));
    audio = path.join(dir, 'audio16k.wav');
    await fs.writeFile(audio, Buffer.alloc(32_000 * 7 + 13));
    await fs.writeFile(path.join(dir, 'ggml-base.bin'), '');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function build(write: boolean): {
    whisper: Whisper;
    calls: { args: string[]; options: RunOptions }[];
  } {
    const calls: { args: string[]; options: RunOptions }[] = [];
    const runner = {
      run: async (_bin: string, args: readonly string[], options: RunOptions = {}) => {
        calls.push({ args: [...args], options });
        const base = args[args.indexOf('--output-file') + 1] ?? '';
        if (write) await fs.writeFile(`${base}.json`, JSON.stringify(OUTPUT));
        options.onLine?.('whisper_print_progress_callback: progress =  50%');
        return { code: write ? 0 : 1, stdout: '', stderr: 'falhou' };
      },
    } as unknown as ProcessRunner;
    const paths = {
      whisperDir: dir,
      whisperModel: (model: string) => path.join(dir, `ggml-${model}.bin`),
    } as unknown as AppPaths;
    return { whisper: new Whisper(paths, runner), calls };
  }

  it('gives each run its own output file and an integer timeout', async () => {
    const { whisper, calls } = build(true);
    const progress: number[] = [];
    const [first, second] = await Promise.all([
      whisper.transcribe(audio, 'base', 'pt', (value) => progress.push(value)),
      whisper.transcribe(audio, 'base', 'pt'),
    ]);
    expect(first.map((word) => word.text.trim())).toEqual(['Olá']);
    expect(second).toHaveLength(1);
    const outputs = calls.map((call) => call.args[call.args.indexOf('--output-file') + 1]);
    expect(new Set(outputs).size).toBe(2);
    for (const output of outputs) expect(path.dirname(output ?? '')).toBe(dir);
    for (const call of calls) expect(Number.isInteger(call.options.timeoutMs)).toBe(true);
    expect(progress).toContain(0.5);
    expect((await fs.readdir(dir)).filter((name) => name.endsWith('.json'))).toEqual([]);
  });

  it('fails clearly when whisper writes nothing', async () => {
    const { whisper } = build(false);
    await expect(whisper.transcribe(audio, 'base', 'pt')).rejects.toThrow(
      /não gerou a transcrição/,
    );
  });

  it('stops whisper when it stops making progress', async () => {
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runner = {
      run: () =>
        new Promise((_resolve, reject) => {
          started();
          currentSignal()?.addEventListener('abort', () => {
            reject(new Error('tarefa cancelada'));
          });
        }),
    } as unknown as ProcessRunner;
    const paths = {
      whisperDir: dir,
      whisperModel: (model: string) => path.join(dir, `ggml-${model}.bin`),
    } as unknown as AppPaths;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const pending = new Whisper(paths, runner).transcribe(audio, 'base', 'pt');
      const settled = expect(pending).rejects.toThrow(/sem avançar/);
      await running;
      await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });
});
