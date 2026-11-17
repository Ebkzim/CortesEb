import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppPaths } from '../config/app-paths.js';
import { advance, canTransition, isFinal } from './job-state.js';
import { QueueStore, type NewJob } from './queue-store.js';

describe('job state machine', () => {
  const base = {
    id: 'j-aaaaaaaaaaaa',
    file: '/x/a.mp4',
    account: 'main',
    platform: 'youtube' as const,
    title: 't',
    description: '',
    tags: [],
    status: 'pending' as const,
    attempts: 0,
    createdAt: '2026-11-17T10:00:00.000Z',
    updatedAt: '2026-11-17T10:00:00.000Z',
  };

  it('allows the normal path and the retry path', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('approved', 'publishing')).toBe(true);
    expect(canTransition('publishing', 'published')).toBe(true);
    expect(canTransition('publishing', 'failed')).toBe(true);
    expect(canTransition('failed', 'approved')).toBe(true);
  });

  it('blocks skipping approval and leaving final states', () => {
    expect(canTransition('pending', 'publishing')).toBe(false);
    expect(canTransition('pending', 'published')).toBe(false);
    expect(canTransition('published', 'approved')).toBe(false);
    expect(isFinal('published')).toBe(true);
    expect(isFinal('rejected')).toBe(true);
    expect(isFinal('failed')).toBe(false);
  });

  it('stamps the update time and clears a stale error on approval', () => {
    const failed = { ...base, status: 'failed' as const, error: 'boom' };
    const next = advance(failed, 'approved', new Date('2026-11-17T11:00:00.000Z'));
    expect(next.status).toBe('approved');
    expect(next.updatedAt).toBe('2026-11-17T11:00:00.000Z');
    expect(next.error).toBeUndefined();
  });

  it('throws on an invalid move', () => {
    expect(() => advance(base, 'published', new Date())).toThrow();
  });
});

describe('QueueStore', () => {
  let dir = '';
  let video = '';
  let store: QueueStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-queue-'));
    video = path.join(dir, 'clip.mp4');
    await fs.writeFile(video, 'x');
    store = new QueueStore({ queueFile: path.join(dir, 'queue.json') } as AppPaths);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const input = (): NewJob => ({
    file: video,
    account: 'main',
    platform: 'youtube',
    title: 'T',
  });

  it('adds pending jobs and persists them with a private mode', async () => {
    const job = await store.add(input());
    expect(job.status).toBe('pending');
    expect(job.id).toMatch(/^j-[a-f0-9]{12}$/);
    expect(await store.list()).toHaveLength(1);
    const mode = (await fs.stat(path.join(dir, 'queue.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('rejects files that are not mp4 or do not exist', async () => {
    await expect(store.add({ ...input(), file: path.join(dir, 'a.txt') })).rejects.toThrow();
    await expect(store.add({ ...input(), file: path.join(dir, 'nao.mp4') })).rejects.toThrow();
  });

  it('claims only approved jobs that are due, oldest first', async () => {
    const early = await store.add(input(), new Date('2026-11-17T10:00:00.000Z'));
    const late = await store.add(input(), new Date('2026-11-17T10:05:00.000Z'));
    const future = await store.add(
      { ...input(), scheduledAt: '2026-11-18T10:00:00.000Z' },
      new Date('2026-11-17T10:06:00.000Z'),
    );
    const now = new Date('2026-11-17T12:00:00.000Z');
    expect(await store.claimNext(now)).toBeNull();
    for (const job of [late, early, future]) await store.transition(job.id, 'approved');
    const first = await store.claimNext(now);
    expect(first?.id).toBe(early.id);
    expect(first?.status).toBe('publishing');
    expect(first?.attempts).toBe(1);
    expect((await store.claimNext(now))?.id).toBe(late.id);
    expect(await store.claimNext(now)).toBeNull();
  });

  it('recovers jobs left publishing after a crash', async () => {
    const job = await store.add(input());
    await store.transition(job.id, 'approved');
    await store.claimNext(new Date(Date.now() + 1000));
    expect(await store.recoverStale()).toBe(1);
    expect((await store.get(job.id)).status).toBe('approved');
  });

  it('serializes concurrent writes without losing jobs', async () => {
    await Promise.all(Array.from({ length: 12 }, () => store.add(input())));
    expect(await store.list()).toHaveLength(12);
  });

  it('refuses an unknown id', async () => {
    await expect(store.get('j-000000000000')).rejects.toThrow();
  });
});
