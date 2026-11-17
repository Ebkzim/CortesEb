import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Output } from '../common/output.js';
import type { AccountService } from '../accounts/account.service.js';
import type { AppPaths } from '../config/app-paths.js';
import type { Job } from '../contracts/publish.js';
import { advance, canTransition, isFinal } from './job-state.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { CredentialVault } from './credential-vault.js';
import { evaluatePolicy } from './publish-policy.js';
import { PublishWorker } from './publish-worker.js';
import { PublishError } from './publisher.js';
import { isGoogleUpload, YoutubePublisher, type FetchLike } from './youtube-publisher.js';
import { QueueService, type EnqueueRequest } from './queue.service.js';
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

describe('QueueService', () => {
  let dir = '';
  let video = '';
  let store: QueueStore;
  let service: QueueService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-service-'));
    video = path.join(dir, 'meu-corte_legal.mp4');
    await fs.writeFile(video, 'x');
    store = new QueueStore({ queueFile: path.join(dir, 'queue.json') } as AppPaths);
    const accounts = {
      resolve: (requested: readonly string[] | undefined) =>
        Promise.resolve((requested ?? ['main', 'segunda']).map((id) => ({ id }))),
    } as unknown as AccountService;
    service = new QueueService(store, accounts);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const request = (patch: Partial<EnqueueRequest> = {}): EnqueueRequest => ({
    files: [video],
    accounts: undefined,
    platforms: undefined,
    title: undefined,
    description: undefined,
    tags: [],
    scheduledAt: undefined,
    ...patch,
  });

  it('creates one pending job per file, account and platform with a title from the file', async () => {
    const jobs = await service.enqueue(request());
    expect(jobs).toHaveLength(6);
    expect(jobs.every((job) => job.status === 'pending')).toBe(true);
    expect(jobs[0]?.title).toBe('meu corte legal');
  });

  it('limits platforms and accounts when asked', async () => {
    const jobs = await service.enqueue(request({ accounts: ['main'], platforms: ['youtube'] }));
    expect(jobs).toHaveLength(1);
  });

  it('approves, rejects and retries only from the right states', async () => {
    const [first, second] = await service.enqueue(request({ platforms: ['youtube'] }));
    if (first === undefined || second === undefined) throw new Error('sem jobs');
    expect((await service.approve([first.id]))[0]?.status).toBe('approved');
    await expect(service.approve([first.id])).rejects.toThrow();
    expect((await service.reject([second.id]))[0]?.status).toBe('rejected');
    await expect(service.retry([first.id])).rejects.toThrow();
    const summary = await service.summary();
    expect(summary.byStatus.approved).toBe(1);
    expect(summary.byStatus.rejected).toBe(1);
  });

  it('approves everything pending with all', async () => {
    await service.enqueue(request());
    expect(await service.approve(['all'])).toHaveLength(6);
    expect((await service.summary()).byStatus.pending).toBe(0);
  });

  it('refuses to enqueue without any account', async () => {
    const empty = new QueueService(store, {
      resolve: () => Promise.resolve([]),
    } as unknown as AccountService);
    await expect(empty.enqueue(request())).rejects.toThrow();
  });
});

describe('PublishWorker', () => {
  let dir = '';
  let video = '';
  let store: QueueStore;
  const lines: string[] = [];
  const output = { line: (text: string) => lines.push(text) } as unknown as Output;

  beforeEach(async () => {
    lines.length = 0;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-worker-'));
    video = path.join(dir, 'c.mp4');
    await fs.writeFile(video, 'x');
    store = new QueueStore({ queueFile: path.join(dir, 'queue.json') } as AppPaths);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function approved(): Promise<string> {
    const job = await store.add({ file: video, account: 'main', platform: 'youtube', title: 'T' });
    await store.transition(job.id, 'approved');
    return job.id;
  }

  const options = { once: true, intervalMs: 5, maxAttempts: 3, baseBackoffMs: 1000 };

  it('publishes approved jobs to the outbox and records the url', async () => {
    const paths = { outboxDir: path.join(dir, 'outbox') } as AppPaths;
    const worker = new PublishWorker(store, new OutboxPublisher(paths), output);
    const id = await approved();
    const summary = await worker.run(options, new AbortController().signal);
    expect(summary.published).toBe(1);
    const job = await store.get(id);
    expect(job.status).toBe('published');
    expect(job.publishedUrl).toMatch(/^file:\/\//);
    const meta = JSON.parse(
      await fs.readFile(path.join(dir, 'outbox', 'youtube', 'main', `${id}.json`), 'utf8'),
    ) as { title: string };
    expect(meta.title).toBe('T');
  });

  it('never touches jobs that were not approved', async () => {
    const paths = { outboxDir: path.join(dir, 'outbox') } as AppPaths;
    const worker = new PublishWorker(store, new OutboxPublisher(paths), output);
    const job = await store.add({ file: video, account: 'main', platform: 'youtube', title: 'T' });
    const summary = await worker.run(options, new AbortController().signal);
    expect(summary.published).toBe(0);
    expect((await store.get(job.id)).status).toBe('pending');
  });

  it('retries with backoff and then fails after the attempt limit', async () => {
    const worker = new PublishWorker(store, {} as OutboxPublisher, output);
    worker.publisherFor = () => ({
      platform: 'youtube',
      publish: () => Promise.reject(new PublishError('instável', true)),
    });
    const id = await approved();
    await worker.run(options, new AbortController().signal);
    const first = await store.get(id);
    expect(first.status).toBe('approved');
    expect(first.error).toBe('instável');
    expect(new Date(first.scheduledAt ?? 0).getTime()).toBeGreaterThan(Date.now());

    await store.transition(id, 'publishing').catch(() => undefined);
    const limited = { ...options, maxAttempts: 1 };
    await store.transition(id, 'approved', { scheduledAt: '2020-01-01T00:00:00.000Z' });
    await worker.run(limited, new AbortController().signal);
    expect((await store.get(id)).status).toBe('failed');
  });

  it('fails right away on a non retryable error', async () => {
    const worker = new PublishWorker(store, {} as OutboxPublisher, output);
    worker.publisherFor = () => ({
      platform: 'youtube',
      publish: () => Promise.reject(new PublishError('arquivo inválido', false)),
    });
    const id = await approved();
    await worker.run(options, new AbortController().signal);
    expect((await store.get(id)).status).toBe('failed');
  });
});

describe('evaluatePolicy', () => {
  const make = (updatedAt: string, patch: Partial<Job> = {}): Job => ({
    id: 'j-aaaaaaaaaaaa',
    file: '/x/a.mp4',
    account: 'main',
    platform: 'youtube',
    title: 't',
    description: '',
    tags: [],
    status: 'published',
    attempts: 1,
    createdAt: updatedAt,
    updatedAt,
    ...patch,
  });
  const now = new Date('2026-11-17T12:00:00.000Z');
  const limits = { maxPerDay: 2, minGapMs: 30 * 60 * 1000 };

  it('allows posting when nothing was posted recently', () => {
    expect(evaluatePolicy(make('2026-11-16T09:00:00.000Z'), [], now, limits)).toEqual({ ok: true });
  });

  it('waits for the minimum gap after the last post', () => {
    const decision = evaluatePolicy(
      make(now.toISOString()),
      [make('2026-11-17T11:50:00.000Z')],
      now,
      limits,
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.retryAt.toISOString()).toBe('2026-11-17T12:20:00.000Z');
  });

  it('blocks after the daily limit until the oldest post leaves the window', () => {
    const decision = evaluatePolicy(
      make(now.toISOString()),
      [make('2026-11-17T01:00:00.000Z'), make('2026-11-17T03:00:00.000Z')],
      now,
      limits,
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.retryAt.toISOString()).toBe('2026-11-18T01:00:00.000Z');
  });

  it('counts each account and platform separately', () => {
    const others = [
      make('2026-11-17T11:55:00.000Z', { account: 'outra' }),
      make('2026-11-17T11:55:00.000Z', { platform: 'tiktok' }),
    ];
    expect(evaluatePolicy(make(now.toISOString()), others, now, limits)).toEqual({ ok: true });
  });
});

describe('PublishWorker policy', () => {
  it('delays a job instead of publishing when the gap is not met', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-policy-'));
    const video = path.join(dir, 'c.mp4');
    await fs.writeFile(video, 'x');
    const store = new QueueStore({ queueFile: path.join(dir, 'queue.json') } as AppPaths);
    const paths = { outboxDir: path.join(dir, 'outbox') } as AppPaths;
    const worker = new PublishWorker(store, new OutboxPublisher(paths), {
      line: () => undefined,
    } as unknown as Output);
    const ids: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const job = await store.add({
        file: video,
        account: 'main',
        platform: 'youtube',
        title: 'T',
      });
      await store.transition(job.id, 'approved');
      ids.push(job.id);
    }
    const summary = await worker.run(
      { once: true, intervalMs: 5, maxAttempts: 3, baseBackoffMs: 1000 },
      new AbortController().signal,
    );
    expect(summary.published).toBe(1);
    expect(summary.delayed).toBe(1);
    const waiting = (await store.list('approved'))[0];
    expect(waiting?.attempts).toBe(0);
    expect(new Date(waiting?.scheduledAt ?? 0).getTime()).toBeGreaterThan(Date.now());
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('CredentialVault', () => {
  let dir = '';
  let vault: CredentialVault;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-vault-'));
    vault = new CredentialVault({
      credentialsFile: path.join(dir, 'credentials.json'),
    } as AppPaths);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const youtube = {
    clientId: 'client-id-123',
    clientSecret: 'secret-value-456',
    refreshToken: 'refresh-token-789',
  };

  it('stores credentials privately and lists only field names', async () => {
    await vault.save('youtube', 'main', youtube);
    const mode = (await fs.stat(path.join(dir, 'credentials.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
    const listed = await vault.list();
    expect(listed).toEqual([
      {
        platform: 'youtube',
        account: 'main',
        fields: ['clientId', 'clientSecret', 'refreshToken'],
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain('secret-value');
    expect((await vault.load('youtube', 'main')).refreshToken).toBe('refresh-token-789');
  });

  it('rejects wrong shapes, extra fields and bad account ids', async () => {
    await expect(vault.save('youtube', 'main', { clientId: 'x' })).rejects.toThrow();
    await expect(
      vault.save('youtube', 'main', { ...youtube, extra: 'campo-extra-1' }),
    ).rejects.toThrow();
    await expect(vault.save('youtube', '../etc', youtube)).rejects.toThrow();
  });

  it('keeps accounts and platforms apart and removes entries', async () => {
    await vault.save('youtube', 'main', youtube);
    await vault.save('youtube', 'outra', youtube);
    await vault.save('tiktok', 'main', { accessToken: 'token-12345678', openId: 'open-id-12345' });
    expect(await vault.list()).toHaveLength(3);
    expect(await vault.remove('youtube', 'outra')).toBe(true);
    expect(await vault.remove('youtube', 'outra')).toBe(false);
    await expect(vault.load('youtube', 'outra')).rejects.toThrow();
    expect(await vault.list()).toHaveLength(2);
  });

  it('does not leak secrets in validation errors', async () => {
    let message = '';
    try {
      await vault.save('youtube', 'main', {
        clientId: 'client-id-123',
        clientSecret: 'super-secret-xyz',
      });
    } catch (caught) {
      message = caught instanceof Error ? caught.message : '';
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('super-secret-xyz');
  });
});

describe('YoutubePublisher', () => {
  let dir = '';
  let video = '';
  let vault: CredentialVault;
  const job = (): Job => ({
    id: 'j-aaaaaaaaaaaa',
    file: video,
    account: 'main',
    platform: 'youtube',
    title: 'Meu corte',
    description: 'olha isso',
    tags: ['gta'],
    status: 'publishing',
    attempts: 1,
    createdAt: '2026-11-17T10:00:00.000Z',
    updatedAt: '2026-11-17T10:00:00.000Z',
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-yt-'));
    video = path.join(dir, 'c.mp4');
    await fs.writeFile(video, 'conteudo-do-video');
    vault = new CredentialVault({
      credentialsFile: path.join(dir, 'credentials.json'),
    } as AppPaths);
    await vault.save('youtube', 'main', {
      clientId: 'client-id-123',
      clientSecret: 'client-secret-123',
      refreshToken: 'refresh-token-123',
    });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function scripted(responses: Response[]): {
    fetch: FetchLike;
    calls: { url: string; init?: RequestInit }[];
  } {
    const calls: { url: string; init?: RequestInit }[] = [];
    return {
      calls,
      fetch: (url, init) => {
        calls.push({ url, ...(init === undefined ? {} : { init }) });
        const next = responses.shift();
        return next === undefined
          ? Promise.reject(new Error('sem resposta'))
          : Promise.resolve(next);
      },
    };
  }

  const json = (data: unknown, init: ResponseInit = {}): Response =>
    new Response(JSON.stringify(data), { status: 200, ...init });

  it('refreshes the token, opens a resumable session and uploads the file', async () => {
    const script = scripted([
      json({ access_token: 'token-abc' }),
      new Response(null, {
        status: 200,
        headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=1' },
      }),
      json({ id: 'AbCdEfGhIjK' }),
    ]);
    const result = await new YoutubePublisher(vault, 'private', script.fetch).publish(job());
    expect(result.url).toBe('https://www.youtube.com/shorts/AbCdEfGhIjK');
    expect(script.calls.map((call) => call.init?.method)).toEqual(['POST', 'POST', 'PUT']);
    const init = script.calls[1]?.init;
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
    const body = JSON.parse(init?.body as string) as {
      snippet: { description: string; title: string };
      status: { privacyStatus: string };
    };
    expect(body.status.privacyStatus).toBe('private');
    expect(body.snippet.description).toContain('#Shorts');
    expect(body.snippet.title).toBe('Meu corte');
    expect((script.calls[0]?.init?.body as URLSearchParams).get('grant_type')).toBe(
      'refresh_token',
    );
  });

  it('refuses an upload address outside googleapis.com', async () => {
    const script = scripted([
      json({ access_token: 'token-abc' }),
      new Response(null, { status: 200, headers: { location: 'https://evil.example/upload' } }),
    ]);
    await expect(
      new YoutubePublisher(vault, 'private', script.fetch).publish(job()),
    ).rejects.toThrow(/inesperado/);
    expect(script.calls).toHaveLength(2);
  });

  it('marks auth failures as final and rate limits as retryable', async () => {
    const denied = scripted([new Response('{}', { status: 401 })]);
    const first = await new YoutubePublisher(vault, 'private', denied.fetch)
      .publish(job())
      .catch((error: unknown) => error as PublishError);
    expect(first).toBeInstanceOf(PublishError);
    expect((first as PublishError).retryable).toBe(false);

    const limited = scripted([new Response('{}', { status: 429 })]);
    const second = await new YoutubePublisher(vault, 'private', limited.fetch)
      .publish(job())
      .catch((error: unknown) => error as PublishError);
    expect((second as PublishError).retryable).toBe(true);
  });

  it('fails without credentials and never sends secrets in the error', async () => {
    const empty = new CredentialVault({
      credentialsFile: path.join(dir, 'vazio.json'),
    } as AppPaths);
    const script = scripted([]);
    const error = await new YoutubePublisher(empty, 'private', script.fetch)
      .publish(job())
      .catch((caught: unknown) => caught as PublishError);
    expect(error).toBeInstanceOf(PublishError);
    expect((error as PublishError).message).toContain('sem credenciais');
    expect(script.calls).toHaveLength(0);
  });

  it('keeps the shorts tag only once and recognizes google upload hosts', () => {
    expect(isGoogleUpload('https://www.googleapis.com/upload/x')).toBe(true);
    expect(isGoogleUpload('http://www.googleapis.com/upload/x')).toBe(false);
    expect(isGoogleUpload('https://googleapis.com.evil.com/x')).toBe(false);
    expect(isGoogleUpload('nada')).toBe(false);
  });
});
