import type { Job } from '../contracts/publish.js';

export const MAX_CAPTION = 2200;
const MAX_HASHTAGS = 30;

export function captionOf(job: Job): string {
  const hashtags = job.tags
    .map((tag) => tag.replace(/^#+/, '').replace(/\s+/g, ''))
    .filter((tag) => tag !== '')
    .slice(0, MAX_HASHTAGS)
    .map((tag) => `#${tag}`);
  const text = job.description.trim() === '' ? job.title.trim() : job.description.trim();
  const present = new Set(
    [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => `#${match[1] ?? ''}`.toLowerCase()),
  );
  const missing = hashtags.filter((tag) => !present.has(tag.toLowerCase()));
  const tail = missing.join(' ');
  const full = [text, tail].filter((part) => part !== '').join('\n\n');
  return full.slice(0, MAX_CAPTION);
}
