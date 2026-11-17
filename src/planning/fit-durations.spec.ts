import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaTools } from '../media/media-tools.js';
import { Workspace } from '../workspace/workspace.js';
import { TargetsService } from './targets.service.js';

describe('TargetsService.fitDurations', () => {
  let dir = '';
  let service: TargetsService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-fit-'));
    const words = Array.from({ length: 200 }, (_, index) => ({
      text: `p${String(index)}`,
      startMs: index * 500,
      endMs: index * 500 + 400,
    }));
    await fs.writeFile(path.join(dir, 'captions.json'), JSON.stringify(words));
    await fs.writeFile(path.join(dir, 'silences.json'), '[]');
    await fs.writeFile(path.join(dir, 'source.mp4'), 'x');
    service = new TargetsService({ duration: () => Promise.resolve(100) } as unknown as MediaTools);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function setup(clipEnd: number, targets: object): Promise<Workspace> {
    await fs.writeFile(
      path.join(dir, 'cuts.json'),
      JSON.stringify({ clips: [{ id: 'um', start: 0, end: clipEnd, pace: 'steady' }] }),
    );
    await fs.writeFile(path.join(dir, 'targets.json'), JSON.stringify(targets));
    return new Workspace(dir);
  }

  const plan = { mode: 'count', sourceSeconds: 100, count: 1, minSeconds: 54, maxSeconds: 90 };

  it('widens the range when the only problem is a clip a bit short', async () => {
    const workspace = await setup(50, plan);
    expect((await service.check(workspace)).ok).toBe(false);
    const result = await service.fitDurations(workspace);
    expect(result.widened).toBe(true);
    expect(result.check.ok).toBe(true);
    expect(result.check.targets?.minSeconds).toBeLessThan(54);
  });

  it('leaves a valid plan alone', async () => {
    const workspace = await setup(70, plan);
    const result = await service.fitDurations(workspace);
    expect(result.widened).toBe(false);
    expect(result.check.ok).toBe(true);
  });

  it('accepts fewer clips than planned', async () => {
    const workspace = await setup(70, { ...plan, count: 4 });
    const result = await service.fitDurations(workspace);
    expect(result.widened).toBe(true);
    expect(result.check.ok).toBe(true);
    expect(result.check.targets?.count).toBe(1);
  });

  it('never hides overlapping clips', async () => {
    await fs.writeFile(
      path.join(dir, 'cuts.json'),
      JSON.stringify({
        clips: [
          { id: 'um', start: 0, end: 60, pace: 'steady' },
          { id: 'dois', start: 50, end: 95, pace: 'steady' },
        ],
      }),
    );
    await fs.writeFile(
      path.join(dir, 'targets.json'),
      JSON.stringify({ ...plan, count: 2, minSeconds: 20 }),
    );
    const result = await service.fitDurations(new Workspace(dir));
    expect(result.widened).toBe(false);
    expect(result.check.ok).toBe(false);
  });
});
