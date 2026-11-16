import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { Secrets } from '../config/secrets.js';

const ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
const TIMEOUT_MS = 15_000;
const CANDIDATES = 5;

const responseSchema = z.object({
  items: z.array(z.object({ link: z.string().max(2048) })).default([]),
});

@Injectable()
export class ImageSearch {
  constructor(private readonly secrets: Secrets) {}

  isConfigured(): boolean {
    return this.secrets.has('GOOGLE_API_KEY') && this.secrets.has('GOOGLE_CSE_ID');
  }

  async search(query: string): Promise<string[]> {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({
      cx: this.secrets.require('GOOGLE_CSE_ID'),
      q: query,
      searchType: 'image',
      num: String(CANDIDATES),
      imgSize: 'large',
      safe: 'active',
    }).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'X-Goog-Api-Key': this.secrets.require('GOOGLE_API_KEY') },
    });
    if (!response.ok) {
      throw new AppError('REMOTE_FAILED', `busca de imagens respondeu ${response.status}`);
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new AppError('REMOTE_FAILED', 'resposta inesperada da busca');
    return parsed.data.items.map((item) => item.link);
  }
}
