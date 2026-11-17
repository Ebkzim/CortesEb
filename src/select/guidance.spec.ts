import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Word } from '../contracts/media.js';
import { attentionMoments } from './attention.js';
import { filterCandidates, promoHits, speechWindows } from './filters.js';
import { buildGuidance, extractGuide, introSeconds, PRESET_HINTS } from './guidance.js';

const guide = [
  '# Nicho',
  '## Metade de baixo',
  '- não entra',
  '## O que rende gancho',
  '- Detalhe de `trailer`.',
  '- Opinião forte.',
  '## Imagens',
  '- não entra',
  '## Cuidados',
  '- Separe rumor de fato.',
].join('\n');

describe('guidance', () => {
  it('keeps only the hook and care sections of a niche guide', () => {
    expect(extractGuide(guide)).toBe(
      '- Detalhe de trailer.\n- Opinião forte.\n- Separe rumor de fato.',
    );
  });

  it('joins the preset hint, the core rules and the niche guide', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-guide-'));
    const file = path.join(dir, 'gta6.md');
    await fs.writeFile(file, guide);
    const text = await buildGuidance('gta6-react', file);
    expect(text).toContain(PRESET_HINTS['gta6-react']);
    expect(text).toContain('ignore essa abertura');
    expect(text).toContain('Guia do nicho');
    expect(text).toContain('Opinião forte');
    expect(await buildGuidance('podcast', path.join(dir, 'nada.md'))).not.toContain(
      'Guia do nicho',
    );
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('skips a longer opening for reacts than for other videos', () => {
    expect(introSeconds('gta6-react', 1200)).toBe(96);
    expect(introSeconds('gta6-react', 300)).toBe(45);
    expect(introSeconds('podcast', 1200)).toBe(48);
    expect(introSeconds('podcast', 100)).toBe(15);
    expect(introSeconds('gta6-react', 100)).toBe(25);
  });
});

describe('filters', () => {
  const word = (text: string, start: number): Word => ({
    text,
    startMs: start * 1000,
    endMs: start * 1000 + 300,
  });
  const candidate = (
    start: number,
    end: number,
    hook: string,
  ): { start: number; end: number; hook: string; title: string; score: number } => ({
    start,
    end,
    hook,
    title: 't',
    score: 9,
  });

  it('spots promo talk', () => {
    expect(promoHits('entra no nosso grupo do whatsapp e se inscreve no canal')).toBe(2);
    expect(promoHits('o mapa é enorme')).toBe(0);
    expect(promoHits('eu estarei ao vivo agora, aqui no meu canal mesmo')).toBe(2);
  });

  it('drops the opening and promo, keeping the rest', () => {
    const words = [word('se', 120), word('inscreve', 121), word('no', 122), word('whatsapp', 123)];
    const result = filterCandidates(
      [
        candidate(10, 40, 'fala galera'),
        candidate(110, 140, 'olha só'),
        candidate(300, 330, 'o mapa é enorme'),
      ],
      words,
      60,
    );
    expect(result.kept.map((item) => item.start)).toEqual([300]);
    expect(result.dropped.map((item) => item.reason)).toEqual([
      'abertura do vídeo',
      'propaganda ou pedido de inscrição',
    ]);
  });
});

describe('speechWindows', () => {
  it('builds non overlapping windows after the opening, densest first', () => {
    const words: Word[] = [];
    for (let second = 0; second < 200; second += 1) {
      const dense = second >= 120 && second < 160;
      const step = dense ? 0.4 : 1.5;
      if (second % 10 === 0) continue;
      if (!dense && second % 2 === 1) continue;
      words.push({
        text: `w${String(second)}`,
        startMs: second * 1000,
        endMs: second * 1000 + step * 500,
      });
    }
    const windows = speechWindows(words, { from: 30, total: 200, length: 30, limit: 3 });
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((window) => window.start >= 30)).toBe(true);
    expect(windows[0]?.start).toBeGreaterThanOrEqual(110);
    for (const [index, window] of windows.entries()) {
      for (const other of windows.slice(index + 1)) {
        expect(window.start < other.end && other.start < window.end).toBe(false);
      }
    }
  });
});

describe('attentionMoments', () => {
  const word = (text: string, second: number): Word => ({
    text,
    startMs: second * 1000,
    endMs: second * 1000 + 400,
  });

  function talk(from: number, to: number): Word[] {
    return Array.from({ length: to - from }, (_, index) =>
      word(`w${String(from + index)}`, from + index),
    );
  }

  it('finds a loud silent stretch followed by a reaction', () => {
    const levels = Array.from({ length: 200 }, (_, second) =>
      second >= 100 && second < 130 ? -14 : -30,
    );
    const words = [...talk(0, 100), ...talk(130, 160)];
    const [moment] = attentionMoments(words, levels, { minSeconds: 20, maxSeconds: 60 });
    expect(moment).toBeDefined();
    expect(moment?.start).toBeCloseTo(98.5);
    expect(moment?.end).toBeGreaterThan(130);
    expect(moment?.end).toBeLessThanOrEqual(158.5);
    expect(moment?.hook.startsWith('w130')).toBe(true);
  });

  it('ignores quiet pauses, pauses without a reaction and the opening', () => {
    const quiet = Array.from({ length: 200 }, (_, second) =>
      second >= 100 && second < 130 ? -45 : -30,
    );
    expect(attentionMoments([...talk(0, 100), ...talk(130, 160)], quiet)).toEqual([]);
    const loud = Array.from({ length: 200 }, (_, second) =>
      second >= 100 && second < 130 ? -14 : -30,
    );
    expect(attentionMoments([...talk(0, 100), word('ok', 135)], loud)).toEqual([]);
    expect(attentionMoments([...talk(0, 100), ...talk(130, 160)], loud, { from: 140 })).toEqual([]);
  });
});
