import type { Word } from '../contracts/media.js';

export interface Token {
  text: string;
  startMs: number;
  endMs: number;
}

const MARKER = /^\s*(\[.*\]|\(.*\))\s*$/;

const LONG_PHRASE = 3;
const LONG_REPEATS = 3;
const SHORT_REPEATS = 6;
const MAX_PHRASE = 16;

const MAX_MARKER_WORDS = 6;
const OPEN = /^[[(]/;
const CLOSE = /[\])]/;
const DASH_ONLY = /^([-–—]+|>+)$/;

const EDGE_JUNK_START = /^[\]()_>]+/;
const EDGE_JUNK_END = /[\][()_]+$/;
const HAS_CONTENT = /[\p{L}\p{N}]/u;

export function dropMarkers(words: readonly Word[]): Word[] {
  const result: Word[] = [];
  let skipped = 0;
  let inside = false;
  for (const word of words) {
    if (inside) {
      skipped += 1;
      if (CLOSE.test(word.text) || skipped >= MAX_MARKER_WORDS) inside = false;
      continue;
    }
    if (OPEN.test(word.text)) {
      inside = !CLOSE.test(word.text);
      skipped = 1;
      continue;
    }
    if (DASH_ONLY.test(word.text)) continue;
    const text = word.text.replace(EDGE_JUNK_START, '').replace(EDGE_JUNK_END, '');
    if (!HAS_CONTENT.test(text)) continue;
    result.push(text === word.text ? word : { ...word, text });
  }
  return result;
}

export function dropLoops(words: readonly Word[]): Word[] {
  const keys = words.map((word) => word.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
  const result: Word[] = [];
  let index = 0;
  while (index < words.length) {
    const loop = findLoop(keys, index);
    if (loop === null) {
      const word = words[index];
      if (word !== undefined) result.push(word);
      index += 1;
      continue;
    }
    result.push(...words.slice(index, index + loop.length));
    index += loop.length * loop.repeats;
  }
  return result;
}

function findLoop(
  keys: readonly string[],
  start: number,
): { length: number; repeats: number } | null {
  for (let length = 1; length <= MAX_PHRASE; length += 1) {
    let repeats = 1;
    while (samePhrase(keys, start, start + length * repeats, length)) repeats += 1;
    const needed = length >= LONG_PHRASE ? LONG_REPEATS : SHORT_REPEATS;
    if (repeats >= needed) return { length, repeats };
  }
  return null;
}

function samePhrase(keys: readonly string[], a: number, b: number, length: number): boolean {
  if (b + length > keys.length) return false;
  for (let offset = 0; offset < length; offset += 1) {
    if (keys[a + offset] !== keys[b + offset]) return false;
  }
  return true;
}

export function mergeTokens(tokens: readonly Token[]): Word[] {
  const words: Word[] = [];
  for (const token of tokens) {
    if (MARKER.test(token.text)) continue;
    const text = token.text.trim();
    if (text === '') continue;
    const last = words[words.length - 1];
    if (last === undefined || /^\s/.test(token.text)) {
      words.push({ text, startMs: token.startMs, endMs: Math.max(token.startMs, token.endMs) });
      continue;
    }
    last.text += text;
    last.endMs = Math.max(last.endMs, token.endMs);
  }
  return words;
}
