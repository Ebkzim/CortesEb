import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Job, Platform } from '../contracts/publish.js';
import type { CredentialVault } from './credential-vault.js';
import { PublishError, type Publisher, type PublishResult } from './publisher.js';

export type Privacy = 'private' | 'unlisted' | 'public';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const API_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 20 * 60_000;
const CATEGORY_PEOPLE_AND_BLOGS = '22';
const SHORTS_TAG = '#Shorts';
const MAX_TITLE = 100;

export class YoutubePublisher implements Publisher {
  readonly platform: Platform = 'youtube';

  constructor(
    private readonly vault: CredentialVault,
    private readonly privacy: Privacy = 'private',
    private readonly request: FetchLike = fetch,
  ) {}

  async publish(job: Job): Promise<PublishResult> {
    const credentials = await this.vault.load('youtube', job.account).catch((error: unknown) => {
      throw new PublishError(error instanceof Error ? error.message : 'sem credenciais', false);
    });
    const size = (await fs.stat(job.file).catch(() => null))?.size;
    if (size === undefined) throw new PublishError('o vídeo não existe mais', false);
    const token = await this.accessToken(credentials);
    const session = await this.startUpload(token, job, size);
    const id = await this.upload(session, job.file, size);
    return { url: `https://www.youtube.com/shorts/${id}` };
  }

  private async accessToken(credentials: Record<string, string>): Promise<string> {
    const response = await this.send(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.clientId ?? '',
        client_secret: credentials.clientSecret ?? '',
        refresh_token: credentials.refreshToken ?? '',
        grant_type: 'refresh_token',
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { access_token?: unknown };
    if (typeof data.access_token !== 'string' || data.access_token === '') {
      throw new PublishError('o Google não devolveu o token de acesso', false);
    }
    return data.access_token;
  }

  private async startUpload(token: string, job: Job, size: number): Promise<string> {
    const response = await this.send(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({
        snippet: {
          title: job.title.slice(0, MAX_TITLE),
          description: withShortsTag(job),
          tags: job.tags,
          categoryId: CATEGORY_PEOPLE_AND_BLOGS,
        },
        status: { privacyStatus: this.privacy, selfDeclaredMadeForKids: false },
      }),
    });
    const location = response.headers.get('location');
    if (location === null || !isGoogleUpload(location)) {
      throw new PublishError('endereço de upload inesperado', false);
    }
    return location;
  }

  private async upload(session: string, file: string, size: number): Promise<string> {
    const response = await this.send(
      session,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
        body: Readable.toWeb(createReadStream(file)) as unknown as BodyInit,
        duplex: 'half',
      } as RequestInit,
      UPLOAD_TIMEOUT_MS,
    );
    const data = (await response.json().catch(() => ({}))) as { id?: unknown };
    if (typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{6,20}$/.test(data.id)) {
      throw new PublishError('o YouTube não devolveu o id do vídeo', true);
    }
    return data.id;
  }

  private async send(url: string, init: RequestInit, timeout = API_TIMEOUT_MS): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new PublishError('falha de rede falando com o Google', true);
    }
    if (response.ok) return response;
    const retryable = response.status === 429 || response.status >= 500;
    throw new PublishError(`o Google respondeu ${response.status}`, retryable);
  }
}

export function isGoogleUpload(location: string): boolean {
  try {
    const url = new URL(location);
    return url.protocol === 'https:' && url.hostname.endsWith('.googleapis.com');
  } catch {
    return false;
  }
}

function withShortsTag(job: Job): string {
  const text = job.description.trim();
  if (text.toLowerCase().includes(SHORTS_TAG.toLowerCase())) return text;
  return `${text}${text === '' ? '' : '\n\n'}${SHORTS_TAG}`.slice(0, 5000);
}
