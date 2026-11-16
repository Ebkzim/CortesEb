import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { assertPublicHost, parsePublicUrl } from '../common/safe-url.js';
import { MAX_IMAGE_BYTES, MIN_IMAGE_BYTES, sniffImage } from './image-sniffer.js';

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;
const USER_AGENT = 'cortes-eb/1';

@Injectable()
export class ImageFetcher {
  async download(link: string, folder: string, baseName: string): Promise<string> {
    const bytes = await this.read(link);
    return this.store(bytes, folder, baseName, MIN_IMAGE_BYTES);
  }

  async importFile(file: string, folder: string, baseName: string): Promise<string> {
    const source = path.resolve(file);
    const stat = await fs.stat(source).catch(() => null);
    if (stat === null || !stat.isFile()) {
      throw new AppError('MISSING_FILE', `não achei a imagem ${source}`);
    }
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new AppError('INVALID_INPUT', `imagem grande demais: ${path.basename(source)}`);
    }
    return this.store(await fs.readFile(source), folder, baseName, 1);
  }

  private async store(
    bytes: Uint8Array,
    folder: string,
    baseName: string,
    minBytes: number,
  ): Promise<string> {
    const extension = sniffImage(bytes);
    if (extension === null) throw new AppError('INVALID_INPUT', 'o arquivo não é PNG, JPG ou WebP');
    if (bytes.length < minBytes) throw new AppError('INVALID_INPUT', 'imagem pequena demais');
    const target = path.join(folder, `${baseName}${extension}`);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(target, bytes);
    return target;
  }

  private async read(link: string): Promise<Uint8Array> {
    let current = parsePublicUrl(link);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicHost(current);
      const response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location !== null) {
        await response.body?.cancel();
        current = parsePublicUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new AppError('REMOTE_FAILED', `imagem respondeu ${response.status}`);
      return readCapped(response);
    }
    throw new AppError('REMOTE_FAILED', 'redirecionamentos demais ao baixar a imagem');
  }
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_IMAGE_BYTES || response.body === null) {
    await response.body?.cancel();
    throw new AppError('REMOTE_FAILED', 'imagem grande demais');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new AppError('REMOTE_FAILED', 'imagem grande demais');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
