import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppPaths } from '../config/app-paths.js';
import { ApiKeyRepository } from './api-key.repository.js';
import { JobRepository } from './job.repository.js';
import { PrismaService } from './prisma.service.js';
import { hintOf, loadMasterKey, SecretBox } from './secret-box.js';

describe('SecretBox', () => {
  const key = Buffer.alloc(32, 7);

  it('round trips and never repeats the same ciphertext', () => {
    const box = new SecretBox(key);
    const first = box.seal('texto-segredo-123');
    const second = box.seal('texto-segredo-123');
    expect(first).not.toBe(second);
    expect(first).not.toContain('segredo');
    expect(box.open(first)).toBe('texto-segredo-123');
  });

  it('refuses tampered data and a different key', () => {
    const sealed = new SecretBox(key).seal('abc');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('xyz').toString('base64url');
    expect(() => new SecretBox(key).open(parts.join('.'))).toThrow();
    expect(() => new SecretBox(Buffer.alloc(32, 9)).open(sealed)).toThrow();
    expect(() => new SecretBox(key).open('lixo')).toThrow();
    expect(() => new SecretBox(Buffer.alloc(8))).toThrow();
  });

  it('agrees on one master key when created concurrently', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-key-race-'));
    try {
      const keys = await Promise.all(
        Array.from({ length: 8 }, () => loadMasterKey(dir, undefined)),
      );
      expect(new Set(keys.map((key) => key.toString('hex'))).size).toBe(1);
      expect((await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('creates a private master key once and reuses it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-key-'));
    const first = await loadMasterKey(dir, undefined);
    const second = await loadMasterKey(dir, undefined);
    expect(first.equals(second)).toBe(true);
    const mode = (await fs.stat(path.join(dir, 'master.key'))).mode & 0o777;
    expect(mode).toBe(0o600);
    const fromEnv = await loadMasterKey(dir, Buffer.alloc(32, 1).toString('base64'));
    expect(fromEnv.equals(Buffer.alloc(32, 1))).toBe(true);
    await expect(loadMasterKey(dir, 'curta')).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('shows only the last characters as a hint', () => {
    expect(hintOf('qualquer-texto-1234')).toBe('••1234');
    expect(hintOf('curta')).toBe('••••');
  });
});

describe('repositories on a real database', () => {
  let prisma: PrismaService;
  let home = '';

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-home-'));
    const paths = {
      home,
      databaseFile: path.join(home, 'cortes.db'),
      packageRoot: path.resolve(import.meta.dirname, '..', '..'),
    } as unknown as AppPaths;
    prisma = new PrismaService(paths);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await fs.rm(home, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.db.jobLog.deleteMany();
    await prisma.db.clip.deleteMany();
    await prisma.db.job.deleteMany();
    await prisma.db.batch.deleteMany();
    await prisma.db.apiKey.deleteMany();
  });

  it('answers a ping', async () => {
    expect(await prisma.ping()).toBe(true);
  });

  it('creates, updates and lists jobs with logs and clips by day', async () => {
    const jobs = new JobRepository(prisma);
    const job = await jobs.create({
      kind: 'cut',
      title: 'Teste',
      preset: 'gameplay-camera',
      request: { a: 1 },
      workDir: '/tmp/x',
    });
    expect(job.status).toBe('queued');
    expect((await jobs.nextQueued('cut'))?.id).toBe(job.id);
    expect(await jobs.nextQueued('live')).toBeNull();
    expect(await jobs.nextQueued('cut', [job.id])).toBeNull();
    await jobs.update(job.id, { status: 'waiting', waiting: { kind: 'camera' } });
    expect((await jobs.get(job.id)).waiting).toEqual({ kind: 'camera' });
    await jobs.update(job.id, { status: 'running', waiting: null });
    expect((await jobs.get(job.id)).waiting).toBeNull();
    await jobs.log(job.id, 'info', 'começou');
    expect((await jobs.logs(job.id)).map((row) => row.message)).toEqual(['começou']);
    for (const day of ['2026-11-17', '2026-11-17', '2026-11-16']) {
      await jobs.addClip({
        jobId: job.id,
        day,
        title: 'c',
        hook: null,
        description: null,
        hashtags: [],
        score: 8,
        seconds: 30,
        file: 'f.mp4',
        thumb: null,
        sizeBytes: 1000,
        account: null,
      });
    }
    expect(await jobs.days()).toEqual([
      { day: '2026-11-17', clips: 2, bytes: 2000 },
      { day: '2026-11-16', clips: 1, bytes: 1000 },
    ]);
    expect(await jobs.clipsOfDay('2026-11-16')).toHaveLength(1);
    expect(await jobs.interruptRunning()).toBe(1);
    expect((await jobs.get(job.id)).status).toBe('interrupted');
    await jobs.update(job.id, { status: 'done' });
    await jobs.remove(job.id);
    const kept = await jobs.clipsOfDay('2026-11-17');
    expect(kept).toHaveLength(2);
    expect(kept.every((clip) => clip.jobId === null)).toBe(true);
    await expect(jobs.get('00000000-0000-0000-0000-000000000000')).rejects.toThrow();
    const other = await jobs.create({
      kind: 'cut',
      title: 'b',
      preset: 'podcast',
      request: {},
      workDir: '/tmp/y',
    });
    await jobs.update(other.id, { status: 'failed' });
    expect((await jobs.removeFinished(['failed'])).map((row) => row.id)).toEqual([other.id]);
  });

  it('stores api keys encrypted and only reveals them on request', async () => {
    const keys = new ApiKeyRepository(prisma, { home } as AppPaths);
    const fake = ['valor', 'de', 'teste', 'segredo', '9876'].join('-');
    const created = await keys.create({
      provider: 'anthropic',
      label: 'Minha chave',
      secret: fake,
    });
    expect(created.hint).toBe('••9876');
    expect(JSON.stringify(await keys.list())).not.toContain('segredo');
    const raw = await prisma.db.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(raw.secret).not.toContain('segredo');
    expect((await keys.reveal(created.id)).secret).toBe(fake);
    expect(await keys.remove(created.id)).toBe(true);
    expect(await keys.list()).toEqual([]);
  });
});
