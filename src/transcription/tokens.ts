import type { Word } from '../contracts/media.js';

export interface Token {
  text: string;
  startMs: number;
  endMs: number;
}

const MARKER = /^\s*\[.*\]\s*$/;

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
