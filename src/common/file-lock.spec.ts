import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireProcessLock, lockHolder, withFileLock } from './file-lock.js';

describe('file locks', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-lock-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('runs critical sections one at a time and cleans up', async () => {
    const lock = path.join(dir, 'q.lock');
    const counter = path.join(dir, 'n.txt');
    await fs.writeFile(counter, '0');
    await Promise.all(
      Array.from({ length: 20 }, () =>
        withFileLock(lock, async () => {
          const value = Number(await fs.readFile(counter, 'utf8'));
          await new Promise((resolve) => setTimeout(resolve, 1));
          await fs.writeFile(counter, String(value + 1));
        }),
      ),
    );
    expect(await fs.readFile(counter, 'utf8')).toBe('20');
    await expect(fs.access(lock)).rejects.toThrow();
  });

  it('breaks a stale lock and times out on a live one', async () => {
    const lock = path.join(dir, 'q.lock');
    await fs.writeFile(lock, '1');
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lock, old, old);
    expect(await withFileLock(lock, () => Promise.resolve('ok'))).toBe('ok');
    await fs.writeFile(lock, '1');
    await expect(
      withFileLock(lock, () => Promise.resolve('x'), {
        staleMs: 60_000,
        timeoutMs: 50,
        retryMs: 5,
      }),
    ).rejects.toThrow(/ocupada/);
  });

  it('lets only one process hold the worker lock and reclaims a dead owner', async () => {
    const lock = path.join(dir, 'w.lock');
    const first = await acquireProcessLock(lock);
    expect(first).not.toBeNull();
    expect(await acquireProcessLock(lock)).toBeNull();
    expect(await lockHolder(lock)).toBe(process.pid);
    await first?.release();
    expect(await lockHolder(lock)).toBeNull();
    await fs.writeFile(lock, '999999999');
    const second = await acquireProcessLock(lock);
    expect(second).not.toBeNull();
    await second?.release();
  });
});
