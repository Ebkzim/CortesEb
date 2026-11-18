import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Progress } from '../common/progress.js';
import { clipSchema, cutsSchema, type Clip } from '../contracts/cuts.js';
import type { Word } from '../contracts/media.js';
import type { LlmClient } from '../llm/llm-client.js';
import type { LlmService } from '../llm/llm.service.js';
import type { MediaTools } from '../media/media-tools.js';
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
    expect(chunks[0]?.text.startsWith('L1 [')).toBe(true);
    const lastLine = chunks[2]?.text.split('\n').pop() ?? '';
    expect(Number(/^L\d+ \[(\d+)\]/.exec(lastLine)?.[1])).toBeGreaterThan(600);
  });

  it('returns nothing for empty speech and one chunk for a short video', () => {
    expect(chunkTranscript([])).toEqual([]);
    expect(chunkTranscript(speech(100))).toHaveLength(1);
  });

  it('breaks lines on pauses', () => {
    const [chunk] = chunkTranscript([word('a', 1, 1.2), word('b', 1.25, 1.5), word('c', 3, 3.2)]);
    expect(chunk?.text.split('\n')).toEqual(['L1 [1] a b', 'L2 [3] c']);
    expect(chunk?.lines.map((line) => [line.id, line.start, line.end])).toEqual([
      [1, 1, 1.5],
      [2, 3, 3.2],
    ]);
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
    const chunk = { from: 0, to: 360, text: 'L1 [1] oi', lines: [] };
    expect(buildUserPrompt(chunk, context)).toContain('120, 340');
    expect(buildUserPrompt(chunk, { ...context, peaks: [] })).not.toContain('Loud');
  });

  it('caps the schema with the per chunk limit', () => {
    const schema = answerJsonSchema(4) as { properties: { clips: { maxItems: number } } };
    expect(schema.properties.clips.maxItems).toBe(4);
  });
});

describe('parseAnswer', () => {
  const chunk = {
    from: 100,
    to: 460,
    text: '',
    lines: [
      { id: 1, start: 120, end: 130, text: 'essa é a frase que abre o corte' },
      { id: 2, start: 131, end: 150, text: 'meio' },
      { id: 3, start: 151, end: 160, text: 'fim' },
      { id: 4, start: 170, end: 172, text: 'olha' },
    ],
  };
  const item = (first: number, last: number): unknown => ({
    first_line: first,
    last_line: last,
    why: 'porque sim',
    score: 8,
    title: 'titulo',
  });

  it('turns line numbers into times and takes the hook from the transcript', () => {
    const text = JSON.stringify({ clips: [item(1, 3), item(9, 12), item(3, 1)] });
    const parsed = parseAnswer(text, chunk);
    expect(parsed).toEqual([
      {
        start: 120,
        end: 160,
        score: 8,
        hook: 'essa é a frase que abre o corte',
        title: 'titulo',
      },
    ]);
  });

  it('joins a short opening line with the next one', () => {
    const text = JSON.stringify({ clips: [item(4, 4)] });
    expect(parseAnswer(text, chunk)[0]?.hook).toBe('olha');
    const longer = JSON.stringify({ clips: [item(2, 3)] });
    expect(parseAnswer(longer, chunk)[0]?.hook).toBe('meio fim');
  });

  it('coerces numeric strings and rejects the wrong shape', () => {
    const text = JSON.stringify({
      clips: [{ first_line: '1', last_line: '3', score: '7', title: 't' }],
    });
    expect(parseAnswer(text, chunk)[0]?.score).toBe(7);
    expect(() => parseAnswer('{"clips":[{"first_line":1}]}', chunk)).toThrow();
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

  function build(
    answers: string[],
    levels: number[] = [],
  ): { service: SelectorService; prompts: string[] } {
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
    const media = { rmsLevels: () => Promise.resolve(levels) } as unknown as MediaTools;
    return { service: new SelectorService(llm, targets, progress, media), prompts };
  }

  const request = {
    llm: {},
    targets: {},
    niche: 'Gameplay',
    minScore: 6,
    chunk: {},
  };

  const lines = chunkTranscript(speech(500))[0]?.lines ?? [];
  const at = (seconds: number): number =>
    lines.find((line) => line.end >= seconds)?.id ?? lines.length;
  const pick = (start: number, end: number, score: number, title: string): unknown => ({
    first_line: at(start),
    last_line: at(end),
    why: 'w',
    score,
    title,
  });
  const answer = (...clips: unknown[]): string => JSON.stringify({ clips });
  const good = answer(pick(40, 80, 9, 'Primeiro corte'), pick(200, 240, 8, 'Segundo corte'));

  it('writes a valid cuts.json from the model answer', async () => {
    const { service } = build([good]);
    const result = await service.run(new Workspace(dir), request);
    expect(result.model).toBe('fake:model');
    expect(result.clips).toHaveLength(2);
    const cuts = cutsSchema.parse(
      JSON.parse(await fs.readFile(path.join(dir, 'cuts.json'), 'utf8')),
    );
    expect(cuts.clips.map((clip) => clip.id)).toEqual(['01-primeiro-corte', '02-segundo-corte']);
    expect(cuts.clips[0]?.hook).toMatch(/^w40/);
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
    const { service } = build([answer(pick(40, 80, 3, 't'))]);
    await expect(service.run(new Workspace(dir), request)).rejects.toThrow(/nota/);
  });

  it('rescores candidates with the judge and skips the opening', async () => {
    const opening = chunkTranscript(speech(500).filter((item) => item.startMs >= 60_000))[0];
    const line = (seconds: number): number =>
      opening?.lines.find((item) => item.end >= seconds)?.id ?? 1;
    const reply = JSON.stringify({
      clips: [
        { first_line: line(100), last_line: line(140), score: 9, title: 'Fraco' },
        { first_line: line(300), last_line: line(340), score: 6, title: 'Forte' },
      ],
    });
    const { service, prompts } = build([
      reply,
      JSON.stringify({ clips: [] }),
      '{"score":2,"title":"x"}',
      '{"why":"bom","standalone":true,"payoff":true,"score":10,"title":"y"}',
    ]);
    const result = await service.run(new Workspace(dir), {
      ...request,
      avoidStartSeconds: 60,
      judge: true,
      guidance: 'É um react de GTA 6.',
    });
    expect(result.clips.map((clip) => [Math.round(clip.start), clip.score])).toEqual([[300, 9]]);
    expect(prompts).toHaveLength(4);
    expect(prompts[0]).not.toContain('w30 ');
  });

  it('falls back to the best weak clips when asked, with a warning', async () => {
    const { service } = build([answer(pick(40, 80, 4, 'Fraco'))]);
    const result = await service.run(new Workspace(dir), { ...request, fallback: true });
    expect(result.clips.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toContain('maior nota');
    expect(result.warnings.join(' ')).toContain('mais fala');
  });

  it('uses the densest speech when the model returns nothing, if fallback is on', async () => {
    const { service } = build([JSON.stringify({ clips: [] }), JSON.stringify({ clips: [] })]);
    const result = await service.run(new Workspace(dir), { ...request, fallback: true });
    expect(result.clips.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toContain('mais fala');
  });

  it('explains when the model returns no usable clip and fallback is off', async () => {
    const { service } = build([JSON.stringify({ clips: [] }), JSON.stringify({ clips: [] })]);
    await expect(service.run(new Workspace(dir), request)).rejects.toThrow(/nenhum trecho válido/);
  });

  it('warns when fewer clips than planned pass the score', async () => {
    const { service } = build([answer(pick(40, 80, 9, 'Unico'))]);
    const result = await service.run(new Workspace(dir), request);
    expect(result.clips).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('pedia 2 cortes');
  });

  it('sends a moment of attention through the judge and takes its title', async () => {
    const quietTalk = [...speech(500)].filter(
      (item) => item.startMs < 100_000 || item.startMs >= 130_000,
    );
    await fs.writeFile(path.join(dir, 'captions.json'), JSON.stringify(quietTalk));
    const levels = Array.from({ length: 500 }, (_, second) =>
      second >= 100 && second < 130 ? -14 : -30,
    );
    const { service } = build(
      [
        JSON.stringify({ clips: [] }),
        JSON.stringify({ clips: [] }),
        '{"why":"reação forte","standalone":true,"payoff":true,"score":9,"title":"Ele travou"}',
      ],
      levels,
    );
    const result = await service.run(new Workspace(dir), {
      ...request,
      judge: true,
      attention: true,
    });
    const cuts = cutsSchema.parse(
      JSON.parse(await fs.readFile(path.join(dir, 'cuts.json'), 'utf8')),
    );
    expect(cuts.clips[0]?.title).toBe('Ele travou');
    expect(result.clips[0]?.score).toBe(8);
  });
});
