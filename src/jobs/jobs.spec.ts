import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppPaths } from '../config/app-paths.js';
import { userConfigSchema } from '../config/user-config.js';
import { jobRequestSchema } from '../contracts/job.js';
import type { JobRepository, NewClip } from '../database/job.repository.js';
import type { MediaTools } from '../media/media-tools.js';
import { buildAgentPrompt } from './agent-prompt.js';
import { SpeedBook } from './speed-book.js';
import { targetsInput, youtubeLink } from './cut-pipeline.js';
import { folderName, LibraryService, localDay } from './library.service.js';
import { bottomPlan, layoutFor, PRESETS, presetOf, rectSpec, withBottom } from './presets.js';

const base = {
  preset: 'gameplay-camera',
  source: { type: 'youtube', url: 'https://www.youtube.com/watch?v=abc' },
  targets: { mode: 'count', count: 3 },
  selector: { kind: 'ollama', model: 'qwen2.5:7b' },
};

describe('job request', () => {
  it('accepts every source type', () => {
    for (const source of [
      { type: 'file', uploadId: '6f1c2c7e-1d2b-4b1a-9c3e-0f4d5a6b7c8d' },
      { type: 'youtube', url: 'https://youtu.be/x' },
      { type: 'vod', platform: 'twitch', url: 'https://www.twitch.tv/videos/1', from: 60, to: 600 },
      { type: 'vod', platform: 'kick', url: 'https://kick.com/video/1' },
    ]) {
      expect(jobRequestSchema.safeParse({ ...base, source }).success).toBe(true);
    }
  });

  it('accepts a duration range and rejects an inverted one', () => {
    const ok = { ...base, targets: { mode: 'duration', minSeconds: 30, maxSeconds: 90 } };
    expect(jobRequestSchema.safeParse(ok).success).toBe(true);
    const bad = { ...base, targets: { mode: 'duration', minSeconds: 90, maxSeconds: 30 } };
    expect(jobRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('only allows the agent for videos and rules for lives', () => {
    const live = { type: 'live', platform: 'twitch', url: 'https://www.twitch.tv/canal' };
    expect(
      jobRequestSchema.safeParse({ ...base, source: live, selector: { kind: 'rules' } }).success,
    ).toBe(true);
    expect(
      jobRequestSchema.safeParse({
        ...base,
        source: live,
        selector: { kind: 'agent', agent: 'claude' },
      }).success,
    ).toBe(false);
    expect(jobRequestSchema.safeParse({ ...base, selector: { kind: 'rules' } }).success).toBe(
      false,
    );
  });

  it('rejects a section that ends before it starts and unknown fields', () => {
    const source = {
      type: 'vod',
      platform: 'youtube',
      url: 'https://youtu.be/x',
      from: 90,
      to: 30,
    };
    expect(jobRequestSchema.safeParse({ ...base, source }).success).toBe(false);
    expect(jobRequestSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it('rejects a camera rectangle outside the frame', () => {
    expect(
      jobRequestSchema.safeParse({ ...base, camera: { x: 90, y: 0, w: 20, h: 20 } }).success,
    ).toBe(false);
  });
});

describe('presets', () => {
  it('has one entry per id with a label and a layout', () => {
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length);
    for (const preset of PRESETS) expect(preset.label.length).toBeGreaterThan(3);
  });

  it('uses the chosen camera only for presets that ask for it', () => {
    const camera = { x: 1, y: 2, w: 20.123, h: 30 };
    expect(layoutFor(presetOf('gameplay-camera'), camera)).toEqual({
      bottom: 'source',
      camera: '1,2,20.12,30',
    });
    expect(layoutFor(presetOf('filmes-cena'), camera)).toEqual({
      camera: 'none',
      frame: 'fit',
    });
    expect(layoutFor(presetOf('podcast'), camera).bottomArea).toBe('36.7,0,63.3,100');
    expect(rectSpec({ x: 0, y: 0, w: 50, h: 50 })).toBe('0,0,50,50');
  });
});

describe('LibraryService', () => {
  let dir = '';
  const added: NewClip[] = [];

  beforeEach(async () => {
    added.length = 0;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-library-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function service(): LibraryService {
    const jobs = {
      addClip: (clip: NewClip) => {
        added.push(clip);
        return Promise.resolve({ ...clip, id: 'c1' });
      },
    } as unknown as JobRepository;
    const media = {
      frame: (_video: string, _at: number, output: string) => fs.writeFile(output, 'jpg'),
      duration: () => Promise.resolve(31.234),
    } as unknown as MediaTools;
    return new LibraryService({ libraryDir: path.join(dir, 'library') } as AppPaths, jobs, media);
  }

  it('moves clips into a folder per day and job, with a thumbnail and no name clashes', async () => {
    const library = service();
    const when = new Date(2026, 10, 17, 10, 0, 0);
    for (let index = 0; index < 2; index += 1) {
      const file = path.join(dir, `render-${String(index)}.mp4`);
      await fs.writeFile(file, 'video');
      await library.add(
        {
          jobId: '6f1c2c7e-1d2b-4b1a-9c3e-0f4d5a6b7c8d',
          jobTitle: 'Live do Sidão!',
          file,
          clipId: '01-gancho',
          title: 'Gancho',
          hook: 'olha isso',
          score: 8,
          account: null,
        },
        when,
      );
    }
    const folder = path.join('2026-11-17', 'live-do-sidao-6f1c2c7e');
    expect(added.map((clip) => clip.file)).toEqual([
      path.join(folder, '01-gancho.mp4'),
      path.join(folder, '01-gancho-2.mp4'),
    ]);
    expect(added[0]?.thumb).toBe(path.join(folder, '01-gancho.jpg'));
    expect(added[0]?.seconds).toBe(31.23);
    expect(added[0]?.sizeBytes).toBe(5);
    const files = await fs.readdir(path.join(dir, 'library', folder));
    expect(files.sort()).toEqual([
      '01-gancho-2.jpg',
      '01-gancho-2.mp4',
      '01-gancho.jpg',
      '01-gancho.mp4',
    ]);
  });

  it('refuses paths that leave the library', () => {
    expect(() => service().absolute('../../etc/passwd')).toThrow();
  });

  it('formats local days and folder names', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(folderName('Ação!!', 'abcdef1234')).toBe('acao-abcdef12');
  });
});

describe('agent prompt', () => {
  it('gives the work dir, the plan and the commands, and forbids rendering', () => {
    const prompt = buildAgentPrompt({
      agent: 'claude',
      workDir: '/home/x/.cortes-eb/jobs/1/work',
      targets: { count: 3, minSeconds: 20, maxSeconds: 60 },
      preset: 'React',
      niche: 'React',
    });
    expect(prompt).toContain('skill cortes-eb');
    expect(prompt).toContain('cortes-eb transcript --work "/home/x/.cortes-eb/jobs/1/work"');
    expect(prompt).toContain('cortes-eb check --work');
    expect(prompt).toContain('3 cortes, cada um entre 20 e 60 segundos');
    expect(prompt).toContain('não renderize');
    const codex = buildAgentPrompt({
      agent: 'codex',
      workDir: '/w',
      targets: { count: 1, minSeconds: 10, maxSeconds: 30 },
      preset: 'Podcast',
      niche: 'Podcast',
    });
    expect(codex).not.toContain('skill');
    expect(codex).toContain('1 corte, cada um');
  });
});

describe('cut pipeline helpers', () => {
  it('maps the request targets to the planner input', () => {
    expect(targetsInput({ ...jobRequestSchema.parse(base) })).toEqual({ count: 3 });
    const ranged = jobRequestSchema.parse({
      ...base,
      targets: { mode: 'duration', minSeconds: 20, maxSeconds: 50 },
    });
    expect(targetsInput(ranged)).toEqual({ minSeconds: 20, maxSeconds: 50 });
  });

  it('uses youtube captions only for whole youtube videos', () => {
    expect(youtubeLink({ type: 'youtube', url: 'https://youtu.be/a' })).toBe('https://youtu.be/a');
    expect(youtubeLink({ type: 'vod', platform: 'youtube', url: 'https://youtu.be/a' })).toBe(
      'https://youtu.be/a',
    );
    expect(
      youtubeLink({ type: 'vod', platform: 'youtube', url: 'https://youtu.be/a', from: 1, to: 9 }),
    ).toBeNull();
    expect(
      youtubeLink({ type: 'vod', platform: 'twitch', url: 'https://twitch.tv/videos/1' }),
    ).toBeNull();
  });
});

describe('SpeedBook', () => {
  it('learns a rate per key and blends new samples', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-speed-'));
    const paths = { inHome: (name: string) => path.join(home, name) } as unknown as AppPaths;
    const book = new SpeedBook(paths);
    expect(await book.estimate('render', 60, 3)).toBe(180);
    await book.record('render', 120, 60);
    expect(await book.rate('render', 3)).toBe(2);
    await book.record('render', 240, 60);
    expect(await book.rate('render', 3)).toBe(3);
    await book.record('Select:ollama-Qwen 3B', 100, 2);
    expect(await new SpeedBook(paths).rate('select:ollama-qwen-3b', 1)).toBe(50);
    await book.record('render', 0, 10);
    expect(await book.rate('render', 3)).toBe(3);
    await fs.rm(home, { recursive: true, force: true });
  });
});

describe('bottom choice', () => {
  const trailer = 'https://www.youtube.com/watch?v=trailer';
  const nicheBacked = { ...presetOf('gameplay-camera'), bottom: 'niche' as const };

  it('uses the preset default when nothing is chosen', () => {
    expect(bottomPlan(nicheBacked, undefined, trailer)).toEqual({
      kind: 'url',
      url: trailer,
    });
    expect(bottomPlan(presetOf('gameplay-camera'), undefined, null)).toEqual({ kind: 'source' });
    expect(bottomPlan(nicheBacked, { type: 'default' }, null)).toEqual({
      kind: 'source',
    });
  });

  it('respects the user choice', () => {
    expect(bottomPlan(nicheBacked, { type: 'source' }, trailer)).toEqual({
      kind: 'source',
    });
    expect(
      bottomPlan(presetOf('podcast'), { type: 'url', url: 'https://youtu.be/x' }, null),
    ).toEqual({ kind: 'url', url: 'https://youtu.be/x' });
    expect(bottomPlan(presetOf('filmes'), { type: 'file', uploadId: 'u' }, null)).toEqual({
      kind: 'file',
      uploadId: 'u',
    });
  });

  it('switches the layout bottom and drops the podcast split for a separate video', () => {
    const podcast = layoutFor(presetOf('podcast'), undefined);
    expect(withBottom(podcast, { kind: 'source' }).bottomArea).toBe('36.7,0,63.3,100');
    const other = withBottom(podcast, { kind: 'url', url: 'https://youtu.be/x' });
    expect(other.bottom).toBe('video');
    expect(other.bottomArea).toBeUndefined();
  });

  it('offers lives only where they make sense', () => {
    expect(presetOf('series').sources).not.toContain('live');
    expect(presetOf('filmes').sources).not.toContain('live');
    expect(presetOf('gameplay-camera').sources).toContain('live');
  });
});

describe('generic presets', () => {
  it('has no game specific preset or niche left', () => {
    expect(PRESETS.map((preset) => preset.id)).not.toContain('gta6-react');
    expect(PRESETS.every((preset) => !/gta/i.test(`${preset.label} ${preset.niche}`))).toBe(true);
    expect(presetOf('react').niche).toBe('react');
  });

  it('moves an old gta6 niche setting to gameplay', () => {
    expect(userConfigSchema.parse({ niche: 'gta6' }).niche).toBe('gameplay');
    expect(userConfigSchema.parse({}).niche).toBe('gameplay');
    expect(userConfigSchema.parse({ niche: 'podcast' }).niche).toBe('podcast');
  });
});
