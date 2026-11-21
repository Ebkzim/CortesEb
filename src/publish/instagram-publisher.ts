import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Job, Platform } from '../contracts/publish.js';
import type { CredentialVault } from './credential-vault.js';
import { captionOf } from './caption.js';
import { PublishError, type Publisher, type PublishResult } from './publisher.js';
import type { FetchLike } from './youtube-publisher.js';

export type Wait = (ms: number) => Promise<void>;

export interface InstagramTiming {
  pollMs: number;
  maxPolls: number;
}

export const INSTAGRAM_TIMING: InstagramTiming = { pollMs: 5_000, maxPolls: 120 };

const GRAPH_URL = 'https://graph.facebook.com/v27.0';
const UPLOAD_HOST = 'rupload.facebook.com';
const API_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 20 * 60_000;
const RETRYABLE_CODES = new Set([1, 2, 4, 9, 17, 32, 341, 613]);
const ID_PATTERN = /^[0-9]{5,30}$/;
const FALLBACK_URL = 'https://www.instagram.com/';
const UNCERTAIN = 'sem confirmação ao publicar; confira o perfil antes de tentar de novo';

interface GraphError {
  error?: { message?: unknown; code?: unknown };
}

export class InstagramPublisher implements Publisher {
  readonly platform: Platform = 'instagram';

  constructor(
    private readonly vault: CredentialVault,
    private readonly request: FetchLike = fetch,
    private readonly wait: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly timing: InstagramTiming = INSTAGRAM_TIMING,
  ) {}

  async publish(job: Job): Promise<PublishResult> {
    const credentials = await this.vault.load('instagram', job.account).catch((error: unknown) => {
      throw new PublishError(error instanceof Error ? error.message : 'sem credenciais', false);
    });
    const token = credentials.accessToken ?? '';
    const userId = credentials.userId ?? '';
    const size = (await fs.stat(job.file).catch(() => null))?.size;
    if (size === undefined) throw new PublishError('o vídeo não existe mais', false);
    const container = await this.createContainer(token, userId, job);
    await this.upload(token, container.uri, job.file, size);
    await this.waitReady(token, container.id);
    const media = await this.graph(token, `/${userId}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: container.id }),
    }).catch((error: unknown) => {
      const known = error instanceof PublishError && !error.message.startsWith('falha de rede');
      throw new PublishError(known ? `${error.message}; ${UNCERTAIN}` : UNCERTAIN, false);
    });
    const mediaId = idOf(media, UNCERTAIN, false);
    return { url: await this.permalink(token, mediaId) };
  }

  private async createContainer(
    token: string,
    userId: string,
    job: Job,
  ): Promise<{ id: string; uri: string }> {
    const data = await this.graph(token, `/${userId}/media`, {
      method: 'POST',
      body: new URLSearchParams({
        media_type: 'REELS',
        upload_type: 'resumable',
        caption: captionOf(job),
      }),
    });
    const id = idOf(data, 'o Instagram não criou o contêiner do reel');
    const uri = (data as { uri?: unknown }).uri;
    if (typeof uri !== 'string' || !isInstagramUpload(uri)) {
      throw new PublishError('endereço de upload inesperado', false);
    }
    return { id, uri };
  }

  private async upload(token: string, uri: string, file: string, size: number): Promise<void> {
    const response = await this.send(
      uri,
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${token}`,
          offset: '0',
          file_size: String(size),
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(size),
        },
        body: Readable.toWeb(createReadStream(file)) as unknown as BodyInit,
        duplex: 'half',
      } as RequestInit,
      UPLOAD_TIMEOUT_MS,
    );
    const data = (await response.json().catch(() => ({}))) as { success?: unknown };
    if (data.success !== true) throw new PublishError('o upload do vídeo não foi aceito', true);
  }

  private async waitReady(token: string, containerId: string): Promise<void> {
    for (let poll = 0; poll < this.timing.maxPolls; poll += 1) {
      const data = (await this.graph(token, `/${containerId}?fields=status_code`)) as {
        status_code?: unknown;
      };
      switch (data.status_code) {
        case 'FINISHED':
        case 'PUBLISHED':
          return;
        case 'ERROR':
          throw new PublishError('o Instagram não conseguiu processar o vídeo', false);
        case 'EXPIRED':
          throw new PublishError('o contêiner do reel expirou', true);
        default:
          await this.wait(this.timing.pollMs);
      }
    }
    throw new PublishError('o Instagram demorou demais para processar o vídeo', true);
  }

  private async permalink(token: string, mediaId: string): Promise<string> {
    const data = (await this.graph(token, `/${mediaId}?fields=permalink`).catch(() => ({}))) as {
      permalink?: unknown;
    };
    return typeof data.permalink === 'string' && isInstagramPermalink(data.permalink)
      ? data.permalink
      : FALLBACK_URL;
  }

  private async graph(token: string, route: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.send(`${GRAPH_URL}${route}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.json().catch(() => ({}));
  }

  private async send(url: string, init: RequestInit, timeout = API_TIMEOUT_MS): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new PublishError('falha de rede falando com o Instagram', true);
    }
    if (response.ok) return response;
    const body = (await response.json().catch(() => ({}))) as GraphError;
    const code = typeof body.error?.code === 'number' ? body.error.code : undefined;
    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      (code !== undefined && RETRYABLE_CODES.has(code));
    const suffix = code === undefined ? '' : ` (código ${code})`;
    throw new PublishError(`o Instagram respondeu ${response.status}${suffix}`, retryable);
  }
}

export { captionOf };

export function isInstagramUpload(location: string): boolean {
  try {
    const url = new URL(location);
    return url.protocol === 'https:' && url.hostname === UPLOAD_HOST;
  } catch {
    return false;
  }
}

function isInstagramPermalink(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && url.hostname === 'www.instagram.com';
  } catch {
    return false;
  }
}

function idOf(data: unknown, message: string, retryable = true): string {
  const id = (data as { id?: unknown }).id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new PublishError(message, retryable);
  return id;
}
