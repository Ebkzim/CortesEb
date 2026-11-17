import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Progress } from '../common/progress.js';
import { clipSchema, cutsSchema, type Clip } from '../contracts/cuts.js';
import type { Word } from '../contracts/media.js';
import type { LlmClient } from '../llm/llm-client.js';
import type { LlmService } from '../llm/llm.service.js';
import type { TargetsService } from '../planning/targets.service.js';
import { Workspace } from '../workspace/workspace.js';
import { pickBest, separate, slug, snap, toClip, usable } from './candidates.js';
import { answerJsonSchema, buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { parseAnswer, SelectorService } from './selector.service.js';
import { chunkTranscript } from './transcript-chunks.js';

const word = (text: string, start: number, end: number): Word => ({
  text,
  startMs: Math.round(start * 1000),
  endMs: Math.round(end * 1000),
});

function speech(seconds: number): Word[] {
  const words: Word[] = [];
  for (let second = 0; second < seconds; second += 1) {
    const base = second + (second % 5 === 0 ? 0.6 : 0);
    words.push(word(`w${second}`, base, base + 0.4));
  }
  return words;
}

describe('chunkTranscript', () => {
  it('splits long speech into overlapping chunks with absolute seconds', () => {
    const chunks = chunkTranscript(speech(800), { chunkSeconds: 360, overlapSeconds: 30 });
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.from).toBe(0);
    expect(chunks[1]?.from).toBe(330);
    expect(chunks[0]?.text.startsWith('[')).toBe(true);
    const lastLine = chunks[2]?.text.split('\n').pop() ?? '';
    expect(Number(/^\[(\d+)\]/.exec(lastLine)?.[1])).toBeGreaterThan(600);
  });

  it('returns nothing for empty speech and one chunk for a short video', () => {
    expect(chunkTranscript([])).toEqual([]);
    expect(chunkTranscript(speech(100))).toHaveLength(1);
  });

  it('breaks lines on pauses', () => {
    const [chunk] = chunkTranscript([word('a', 1, 1.2), word('b', 1.25, 1.5), word('c', 3, 3.2)]);
    expect(chunk?.text.split('\n')).toEqual(['[1] a b', '[3] c']);
  });
});

describe('prompt', () => {
  const context = {
    niche: 'GTA 6',
    perChunk: 3,
    targets: { minSeconds: 20, maxSeconds: 60 },
    peaks: [120, 340],
  };

  it('states the duration rules, the limit and the json shape', () => {
    const system = buildSystemPrompt(context);
    expect(system).toContain('between 20 and 60 seconds');
    expect(system).toContain('at most 3 clips');
    expect(system).toContain('GTA 6');
    expect(system).toContain('{"clips"');
  });

  it('includes peak hints only when there are some', () => {
    const chunk = { from: 0, to: 360, text: '[1] oi' };
    expect(buildUserPrompt(chunk, context)).toContain('120, 340');
    expect(buildUserPrompt(chunk, { ...context, peaks: [] })).not.toContain('Loud');
  });

  it('caps the schema with the per chunk limit', () => {
    const schema = answerJsonSchema(4) as { properties: { clips: { maxItems: number } } };
    expect(schema.properties.clips.maxItems).toBe(4);
  });
});

describe('parseAnswer', () => {
  const chunk = { from: 100, to: 460, text: '' };
  const item = (start: number, end: number): unknown => ({
    start,
    end,
    score: 8,
    hook: 'gancho',
    title: 'titulo',
  });

  it('accepts clips inside the chunk and drops others', () => {
    const text = JSON.stringify({ clips: [item(120, 160), item(20, 60), item(300, 290)] });
    expect(parseAnswer(text, chunk)).toHaveLength(1);
  });

  it('coerces numeric strings and rejects the wrong shape', () => {
    const text = JSON.stringify({
      clips: [{ start: '120', end: '160', score: '7', hook: 'h', title: 't' }],
    });
    expect(parseAnswer(text, chunk)[0]?.score).toBe(7);
    expect(() => parseAnswer('{"clips":[{"start":1}]}', chunk)).toThrow();
    expect(() => parseAnswer('nada', chunk)).toThrow();
  });
});

describe('candidate selection', () => {
  const limits = { minSeconds: 20, maxSeconds: 60, total: 600 };
  const candidate = (
    start: number,
    end: number,
    score: number,
  ): { start: number; end: number; score: number; hook: string; title: string } => ({
    start,
    end,
    score,
    hook: 'h',
    title: 'Título Legal!',
  });

  it('keeps only candidates with a sane duration', () => {
    expect(usable(candidate(10, 50, 8), limits)).not.toBeNull();
    expect(usable(candidate(10, 15, 8), limits)).toBeNull();
    expect(usable(candidate(10, 200, 8), limits)).toBeNull();
    expect(usable(candidate(590, 700, 8), limits)).toBeNull();
  });

  it('picks the best non overlapping clips above the minimum score, in time order', () => {
    const picked = pickBest(
      [
        candidate(100, 140, 9),
        candidate(110, 150, 8),
        candidate(300, 340, 7),
        candidate(400, 440, 5),
      ],
      3,
      6,
    );
    expect(picked.map((item) => item.start)).toEqual([100, 300]);
  });

  it('respects the requested count', () => {
    const many = [10, 100, 200, 300].map((start) => candidate(start, start + 40, 8));
    expect(pickBest(many, 2, 6)).toHaveLength(2);
  });

  it('snaps to sentence edges and caps the length', () => {
    const words = [
      word('a', 9.5, 9.9),
      word('b', 10, 10.3),
      word('c', 10.35, 41.9),
      word('d', 42.5, 43),
    ];
    const snapped = snap(candidate(11, 41, 8), words, limits);
    expect(snapped.start).toBe(9.5);
    expect(snapped.end).toBeCloseTo(41.9, 1);
  });

  it('builds a valid clip with a slug id', () => {
    const clip = toClip({ ...candidate(10, 50, 8.4), start: 10, end: 50 }, 0, 600);
    expect(clip.id).toBe('01-titulo-legal');
    expect(clip.score).toBe(8);
    expect(cutsSchema.safeParse({ clips: [clip] }).success).toBe(true);
  });

  it('slugs accents, symbols and empty titles', () => {
    expect(slug('Ação é isso, né?!')).toBe('acao-e-isso-ne');
    expect(slug('???')).toBe('corte');
    expect(slug('a'.repeat(100))).toHaveLength(40);
  });
});

describe('separate', () => {
  const clip = (id: string, start: number, end: number, score: number): Clip =>
    clipSchema.parse({ id, start, end, score });

  it('trims a clip that runs into the next one by a fraction of a second', () => {
    const result = separate([clip('01-a', 11.37, 28.15, 8), clip('02-b', 27.85, 54.15, 9)]);
    expect(result.map((item) => [item.id, item.start, item.end])).toEqual([
      ['01-a', 11.37, 27.85],
      ['02-b', 27.85, 54.15],
    ]);
  });

  it('keeps the better clip when two almost coincide and renumbers the ids', () => {
    const result = separate([
      clip('01-a', 10, 40, 6),
      clip('02-b', 12, 42, 9),
      clip('03-c', 60, 90, 7),
    ]);
    expect(result.map((item) => item.id)).toEqual(['01-b', '02-c']);
  });

  it('leaves separate clips alone', () => {
    const input = [clip('01-a', 0, 20, 7), clip('02-b', 20, 40, 7)];
    expect(separate(input)).toEqual(input);
  });
});

describe('SelectorService', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-select-'));
    await fs.writeFile(path.join(dir, 'captions.json'), JSON.stringify(speech(500)));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function build(answers: string[]): { service: SelectorService; prompts: string[] } {
    const prompts: string[] = [];
    const client: LlmClient = {
      label: 'fake:model',
      complete: (request) => {
        prompts.push(request.user);
        const next = answers.shift();
        return next === undefined
          ? Promise.reject(new Error('sem resposta'))
          : Promise.resolve(next);
      },
    };
    const llm = { client: () => Promise.resolve(client) } as unknown as LlmService;
    const targets = {
      define: () =>
        Promise.resolve({
          mode: 'count',
          sourceSeconds: 500,
          count: 2,
          minSeconds: 20,
          maxSeconds: 60,
        }),
    } as unknown as TargetsService;
    const progress = { step: () => undefined } as unknown as Progress;
    return { service: new SelectorService(llm, targets, progress), prompts };
  }

  const request = {
    llm: {},
    targets: {},
    niche: 'Gameplay',
    minScore: 6,
    chunk: {},
  };

  const good = JSON.stringify({
    clips: [
      { start: 40, end: 80, score: 9, hook: 'primeiro gancho', title: 'Primeiro corte' },
      { start: 200, end: 240, score: 8, hook: 'segundo gancho', title: 'Segundo corte' },
    ],
  });

  it('writes a valid cuts.json from the model answer', async () => {
    const { service } = build([good]);
    const result = await service.run(new Workspace(dir), request);
    expect(result.model).toBe('fake:model');
    expect(result.clips).toHaveLength(2);
    const cuts = cutsSchema.parse(
      JSON.parse(await fs.readFile(path.join(dir, 'cuts.json'), 'utf8')),
    );
    expect(cuts.clips.map((clip) => clip.id)).toEqual(['01-primeiro-corte', '02-segundo-corte']);
    expect(cuts.clips[0]?.hook).toBe('primeiro gancho');
  });

  it('retries once when the first answer is not valid json', async () => {
    const { service, prompts } = build(['isso não é json', good]);
    const result = await service.run(new Workspace(dir), request);
    expect(result.clips).toHaveLength(2);
    expect(prompts[1]).toContain('not valid');
  });

  it('warns about a chunk that keeps failing and fails when nothing is selected', async () => {
    const { service } = build(['ruim', 'ruim']);
    await expect(service.run(new Workspace(dir), request)).rejects.toThrow(/nenhum trecho válido/);
  });

  it('refuses clips below the minimum score', async () => {
    const weak = JSON.stringify({
      clips: [{ start: 40, end: 80, score: 3, hook: 'h', title: 't' }],
    });
    const { service } = build([weak]);
    await expect(service.run(new Workspace(dir), request)).rejects.toThrow(/nota/);
  });

  it('falls back to the best weak clips when asked, with a warning', async () => {
    const weak = JSON.stringify({
      clips: [{ start: 40, end: 80, score: 4, hook: 'h', title: 'Fraco' }],
    });
    const { service } = build([weak]);
    const result = await service.run(new Workspace(dir), { ...request, fallback: true });
    expect(result.clips).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('maior nota');
  });

  it('explains when the model returns no usable clip at all', async () => {
    const { service } = build([JSON.stringify({ clips: [] })]);
    await expect(service.run(new Workspace(dir), { ...request, fallback: true })).rejects.toThrow(
      /nenhum trecho válido/,
    );
  });

  it('warns when fewer clips than planned pass the score', async () => {
    const one = JSON.stringify({
      clips: [{ start: 40, end: 80, score: 9, hook: 'h', title: 'Unico' }],
    });
    const { service } = build([one]);
    const result = await service.run(new Workspace(dir), request);
    expect(result.clips).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('pedia 2 cortes');
  });
});
