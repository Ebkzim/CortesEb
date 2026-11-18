import type { Word } from '../contracts/media.js';
import type { Candidate } from './prompt.js';

const PROMO = [
  /inscrev/,
  /\blike\b/,
  /deix[ae] (o|seu) (like|joinha)/,
  /ativa o sininho|ativ[ae] (o )?sino/,
  /link na descri|link (no|na) bio|cupom|desconto|promo[cç][aã]o/,
  /grupo (do|de) (whats|zap|telegram)|whatsapp|telegram/,
  /patroc[ií]n|oferecimento|parceiro (do canal|de hoje)/,
  /seja (o )?membro|apoia(se)? o canal|pix/,
  /(estarei|estou|t[oô]) ao vivo|live agora|ao vivo agora/,
  /no meu canal|fiquem ligados|nos vemos na live/,
];

export function promoHits(text: string): number {
  const clean = text.toLowerCase();
  return PROMO.reduce((total, pattern) => total + (pattern.test(clean) ? 1 : 0), 0);
}

export function textOf(words: readonly Word[], from: number, to: number): string {
  return words
    .filter((word) => word.startMs / 1000 >= from && word.startMs / 1000 <= to)
    .map((word) => word.text)
    .join(' ');
}

export interface FilterResult {
  kept: Candidate[];
  dropped: { candidate: Candidate; reason: string }[];
}

export function filterCandidates(
  candidates: readonly Candidate[],
  words: readonly Word[],
  avoidStart: number,
): FilterResult {
  const kept: Candidate[] = [];
  const dropped: FilterResult['dropped'] = [];
  for (const candidate of candidates) {
    if (candidate.start < avoidStart) {
      dropped.push({ candidate, reason: 'abertura do vídeo' });
      continue;
    }
    if (promoHits(`${candidate.hook} ${textOf(words, candidate.start, candidate.end)}`) >= 2) {
      dropped.push({ candidate, reason: 'propaganda ou pedido de inscrição' });
      continue;
    }
    kept.push(candidate);
  }
  return { kept, dropped };
}

export interface WindowOptions {
  from: number;
  total: number;
  length: number;
  limit: number;
}

const BREAK_MS = 350;
const HOOK_WORDS = 10;
const TITLE_WORDS = 6;
const BASE_SCORE = 5;

export function speechWindows(words: readonly Word[], options: WindowOptions): Candidate[] {
  const starts = words.filter((word, index) => {
    const before = words[index - 1];
    return (
      word.startMs / 1000 >= options.from &&
      (before === undefined || word.startMs - before.endMs >= BREAK_MS)
    );
  });
  const ranked = starts
    .map((word) => {
      const start = word.startMs / 1000;
      const end = Math.min(options.total, start + options.length);
      const inside = words.filter(
        (item) => item.startMs / 1000 >= start && item.endMs / 1000 <= end,
      );
      return { start, end, inside, density: inside.length / Math.max(1, end - start) };
    })
    .filter((window) => window.end - window.start >= options.length * 0.7)
    .sort((a, b) => b.density - a.density);
  const chosen: Candidate[] = [];
  for (const window of ranked) {
    if (chosen.some((other) => window.start < other.end && other.start < window.end)) continue;
    const text = window.inside.map((item) => item.text);
    chosen.push({
      start: window.start,
      end: window.end,
      score: BASE_SCORE,
      hook: text.slice(0, HOOK_WORDS).join(' ') || 'trecho',
      title: text.slice(0, TITLE_WORDS).join(' ') || 'Corte',
    });
    if (chosen.length >= options.limit) break;
  }
  return chosen;
}
