import type { Word } from '../contracts/media.js';
import { sentenceStarts } from '../timeline/boundaries.js';

export interface TranscriptChunk {
  from: number;
  to: number;
  text: string;
}

export interface ChunkOptions {
  chunkSeconds: number;
  overlapSeconds: number;
  maxWordsPerLine: number;
}

export const CHUNK_DEFAULTS: ChunkOptions = {
  chunkSeconds: 360,
  overlapSeconds: 30,
  maxWordsPerLine: 30,
};

export function chunkTranscript(
  words: readonly Word[],
  options: Partial<ChunkOptions> = {},
): TranscriptChunk[] {
  const config = { ...CHUNK_DEFAULTS, ...options };
  const last = words[words.length - 1];
  if (last === undefined) return [];
  const total = last.endMs / 1000;
  const step = Math.max(1, config.chunkSeconds - config.overlapSeconds);
  const chunks: TranscriptChunk[] = [];
  for (let from = 0; from < total; from += step) {
    const to = Math.min(total, from + config.chunkSeconds);
    const inside = words.filter((word) => word.startMs / 1000 >= from && word.startMs / 1000 < to);
    const text = linesFor(inside, config.maxWordsPerLine);
    if (text !== '') chunks.push({ from, to, text });
    if (to >= total) break;
  }
  return chunks;
}

function linesFor(words: readonly Word[], maxWords: number): string {
  const starts = new Set(sentenceStarts(words).map((value) => Math.round(value * 1000)));
  const lines: string[] = [];
  let current: string[] = [];
  let lineStart = 0;
  const flush = (): void => {
    if (current.length > 0) lines.push(`[${lineStart.toFixed(0)}] ${current.join(' ')}`);
    current = [];
  };
  for (const word of words) {
    const breaks = starts.has(Math.round(word.startMs)) && current.length > 0;
    if (breaks || current.length >= maxWords) flush();
    if (current.length === 0) lineStart = word.startMs / 1000;
    current.push(word.text);
  }
  flush();
  return lines.join('\n');
}
