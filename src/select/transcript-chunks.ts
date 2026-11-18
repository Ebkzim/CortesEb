import type { Word } from '../contracts/media.js';
import { sentenceStarts } from '../timeline/boundaries.js';

export interface TranscriptLine {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptChunk {
  from: number;
  to: number;
  text: string;
  lines: TranscriptLine[];
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
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return [];
  const total = last.endMs / 1000;
  const step = Math.max(1, config.chunkSeconds - config.overlapSeconds);
  const chunks: TranscriptChunk[] = [];
  const begin = Math.floor(first.startMs / 1000);
  for (let from = begin; from < total; from += step) {
    const to = Math.min(total, from + config.chunkSeconds);
    const inside = words.filter((word) => word.startMs / 1000 >= from && word.startMs / 1000 < to);
    const lines = linesFor(inside, config.maxWordsPerLine);
    if (lines.length > 0) chunks.push({ from, to, lines, text: render(lines) });
    if (to >= total) break;
  }
  return chunks;
}

function render(lines: readonly TranscriptLine[]): string {
  return lines
    .map((line) => `L${String(line.id)} [${line.start.toFixed(0)}] ${line.text}`)
    .join('\n');
}

function linesFor(words: readonly Word[], maxWords: number): TranscriptLine[] {
  const starts = new Set(sentenceStarts(words).map((value) => Math.round(value * 1000)));
  const lines: TranscriptLine[] = [];
  let current: Word[] = [];
  const flush = (): void => {
    const head = current[0];
    const tail = current[current.length - 1];
    if (head !== undefined && tail !== undefined) {
      lines.push({
        id: lines.length + 1,
        start: head.startMs / 1000,
        end: tail.endMs / 1000,
        text: current.map((word) => word.text).join(' '),
      });
    }
    current = [];
  };
  for (const word of words) {
    const breaks = starts.has(Math.round(word.startMs)) && current.length > 0;
    if (breaks || current.length >= maxWords) flush();
    current.push(word);
  }
  flush();
  return lines;
}
