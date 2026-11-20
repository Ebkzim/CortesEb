import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppPaths } from '../config/app-paths.js';
import type { Job } from '../contracts/publish.js';
import { CredentialVault } from './credential-vault.js';
import { captionOf, InstagramPublisher, isInstagramUpload } from './instagram-publisher.js';
import { PublishError } from './publisher.js';
import type { FetchLike } from './youtube-publisher.js';

const TOKEN = 'token-instagram-123';
const USER = '17841400000000001';
const CONTAINER = '18110000000000001';
const MEDIA = '18120000000000001';
const UPLOAD_URI = `https://rupload.facebook.com/ig-api-upload/v27.0/${CONTAINER}`;
const FAST = { pollMs: 1, maxPolls: 3 };

describe('InstagramPublisher', () => {
  let dir = '';
  let video = '';
  let vault: CredentialVault;
  const job = (patch: Partial<Job> = {}): Job => ({
    id: 'j-bbbbbbbbbbbb',
    file: video,
    account: 'main',
    platform: 'instagram',
    title: 'Meu corte',
    description: 'olha isso',
    tags: ['gta6', '#rockstar'],
    status: 'publishing',
    attempts: 1,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    ...patch,
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-ig-'));
    video = path.join(dir, 'c.mp4');
    await fs.writeFile(video, 'conteudo-do-video');
    vault = new CredentialVault({
      credentialsFile: path.join(dir, 'credentials.json'),
    } as AppPaths);
    await vault.save('instagram', 'main', { accessToken: TOKEN, userId: USER });
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
  const noWait = (): Promise<void> => Promise.resolve();
  const publisher = (fetch: FetchLike): InstagramPublisher =>
    new InstagramPublisher(vault, fetch, noWait, FAST);
  const failure = (fetch: FetchLike, value = job()): Promise<PublishError> =>
    publisher(fetch)
      .publish(value)
      .then(
        () => {
          throw new Error('deveria falhar');
        },
        (error: unknown) => error as PublishError,
      );

  it('creates a resumable reel, uploads, waits, publishes and returns the permalink', async () => {
    const script = scripted([
      json({ id: CONTAINER, uri: UPLOAD_URI }),
      json({ success: true }),
      json({ status_code: 'IN_PROGRESS' }),
      json({ status_code: 'FINISHED' }),
      json({ id: MEDIA }),
      json({ permalink: 'https://www.instagram.com/reel/AbC123/' }),
    ]);
    const result = await publisher(script.fetch).publish(job());
    expect(result.url).toBe('https://www.instagram.com/reel/AbC123/');
    expect(script.calls.map((call) => new URL(call.url).hostname)).toEqual([
      'graph.facebook.com',
      'rupload.facebook.com',
      'graph.facebook.com',
      'graph.facebook.com',
      'graph.facebook.com',
      'graph.facebook.com',
    ]);
    const create = script.calls[0];
    expect(create?.url).toContain(`/${USER}/media`);
    const body = create?.init?.body as URLSearchParams;
    expect(body.get('media_type')).toBe('REELS');
    expect(body.get('upload_type')).toBe('resumable');
    expect(body.get('caption')).toBe('Meu corte\n\nolha isso\n\n#gta6 #rockstar');
    const upload = script.calls[1]?.init?.headers as Record<string, string>;
    expect(upload.Authorization).toBe(`OAuth ${TOKEN}`);
    expect(upload.offset).toBe('0');
    expect(upload.file_size).toBe(String('conteudo-do-video'.length));
    const publish = script.calls[4];
    expect(publish?.url).toContain(`/${USER}/media_publish`);
    expect((publish?.init?.body as URLSearchParams).get('creation_id')).toBe(CONTAINER);
    for (const call of script.calls) expect(call.url).not.toContain(TOKEN);
  });

  it('refuses an upload address outside rupload.facebook.com', async () => {
    const script = scripted([json({ id: CONTAINER, uri: 'https://evil.example/upload' })]);
    const error = await failure(script.fetch);
    expect(error.message).toMatch(/inesperado/);
    expect(script.calls).toHaveLength(1);
  });

  it('stops on a processing error without retrying', async () => {
    const script = scripted([
      json({ id: CONTAINER, uri: UPLOAD_URI }),
      json({ success: true }),
      json({ status_code: 'ERROR' }),
    ]);
    const error = await failure(script.fetch);
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/processar/);
  });

  it('gives up retryably when processing takes too long', async () => {
    const script = scripted([
      json({ id: CONTAINER, uri: UPLOAD_URI }),
      json({ success: true }),
      json({ status_code: 'IN_PROGRESS' }),
      json({ status_code: 'IN_PROGRESS' }),
      json({ status_code: 'IN_PROGRESS' }),
    ]);
    const error = await failure(script.fetch);
    expect(error.retryable).toBe(true);
    expect(script.calls).toHaveLength(5);
  });

  it('never retries when the publish step loses its answer', async () => {
    const script = scripted([
      json({ id: CONTAINER, uri: UPLOAD_URI }),
      json({ success: true }),
      json({ status_code: 'FINISHED' }),
    ]);
    const error = await failure(script.fetch);
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/confira o perfil/);
  });

  it('treats an invalid token as final and rate limits as retryable', async () => {
    const denied = scripted([json({ error: { code: 190 } }, { status: 400 })]);
    const first = await failure(denied.fetch);
    expect(first.retryable).toBe(false);
    expect(first.message).toContain('190');
    expect(first.message).not.toContain(TOKEN);

    const limited = scripted([json({ error: { code: 4 } }, { status: 400 })]);
    expect((await failure(limited.fetch)).retryable).toBe(true);
  });

  it('falls back to the profile address when the permalink is missing', async () => {
    const script = scripted([
      json({ id: CONTAINER, uri: UPLOAD_URI }),
      json({ success: true }),
      json({ status_code: 'FINISHED' }),
      json({ id: MEDIA }),
      json({ permalink: 'https://evil.example/x' }),
    ]);
    expect((await publisher(script.fetch).publish(job())).url).toBe('https://www.instagram.com/');
  });

  it('fails without credentials before calling the api', async () => {
    const empty = new CredentialVault({
      credentialsFile: path.join(dir, 'vazio.json'),
    } as AppPaths);
    const script = scripted([]);
    const error = await new InstagramPublisher(empty, script.fetch, noWait, FAST)
      .publish(job())
      .catch((caught: unknown) => caught as PublishError);
    expect(error).toBeInstanceOf(PublishError);
    expect((error as PublishError).retryable).toBe(false);
    expect(script.calls).toHaveLength(0);
  });

  it('builds captions without repeating hashtags and within the limit', () => {
    expect(captionOf(job({ description: 'veja #gta6', tags: ['gta6', 'rockstar'] }))).toBe(
      'Meu corte\n\nveja #gta6\n\n#rockstar',
    );
    expect(captionOf(job({ description: '', tags: [] }))).toBe('Meu corte');
    expect(captionOf(job({ description: 'x'.repeat(2200) })).length).toBe(2200);
  });

  it('recognizes only the instagram upload host', () => {
    expect(isInstagramUpload(UPLOAD_URI)).toBe(true);
    expect(isInstagramUpload('http://rupload.facebook.com/x')).toBe(false);
    expect(isInstagramUpload('https://rupload.facebook.com.evil.com/x')).toBe(false);
    expect(isInstagramUpload('nada')).toBe(false);
  });
});
