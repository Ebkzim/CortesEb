import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './app-error.js';

export interface FileLockOptions {
  staleMs: number;
  timeoutMs: number;
  retryMs: number;
}

export const FILE_LOCK_DEFAULTS: FileLockOptions = {
  staleMs: 30_000,
  timeoutMs: 20_000,
  retryMs: 40,
};

export async function withFileLock<T>(
  lockFile: string,
  work: () => Promise<T>,
  options: FileLockOptions = FILE_LOCK_DEFAULTS,
): Promise<T> {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  const started = Date.now();
  for (;;) {
    const handle = await fs.open(lockFile, 'wx', 0o600).catch((error: unknown) => {
      if (isCode(error, 'EEXIST')) return null;
      throw error;
    });
    if (handle !== null) {
      try {
        await handle.writeFile(`${String(process.pid)}\n`);
        return await work();
      } finally {
        await handle.close().catch(() => undefined);
        await fs.rm(lockFile, { force: true });
      }
    }
    const stat = await fs.stat(lockFile).catch(() => null);
    if (stat !== null && Date.now() - stat.mtimeMs > options.staleMs) {
      await fs.rm(lockFile, { force: true });
      continue;
    }
    if (Date.now() - started > options.timeoutMs) {
      throw new AppError('PROCESS_FAILED', 'a fila está ocupada por outro processo; tente de novo');
    }
    await new Promise((resolve) => setTimeout(resolve, options.retryMs));
  }
}

export interface ProcessLock {
  release(): Promise<void>;
}

export async function acquireProcessLock(lockFile: string): Promise<ProcessLock | null> {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const handle = await fs.open(lockFile, 'wx', 0o600).catch((error: unknown) => {
      if (isCode(error, 'EEXIST')) return null;
      throw error;
    });
    if (handle !== null) {
      await handle.writeFile(`${String(process.pid)}\n`);
      await handle.close();
      return {
        release: async () => {
          if ((await lockOwner(lockFile)) === process.pid) await fs.rm(lockFile, { force: true });
        },
      };
    }
    const owner = await lockOwner(lockFile);
    if (owner !== null && isAlive(owner)) return null;
    await fs.rm(lockFile, { force: true });
  }
  return null;
}

export async function lockHolder(lockFile: string): Promise<number | null> {
  const owner = await lockOwner(lockFile);
  return owner !== null && isAlive(owner) ? owner : null;
}

async function lockOwner(lockFile: string): Promise<number | null> {
  const text = await fs.readFile(lockFile, 'utf8').catch(() => null);
  if (text === null) return null;
  const pid = Number.parseInt(text.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isCode(error, 'EPERM');
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
