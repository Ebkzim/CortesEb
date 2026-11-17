import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserConfigStore } from '../config/user-config.js';
import { clipSchema, type Clip } from '../contracts/cuts.js';
import { Workspace } from '../workspace/workspace.js';
import { applyLayout, mergeLayouts } from './layout.js';
import { LayoutService } from './layout.service.js';

const frame = { duration: 100, width: 1920, height: 1080, fps: '30/1' };
const clip = (patch: object = {}): Clip =>
  clipSchema.parse({ id: 'um', start: 1, end: 30, ...patch });

describe('applyLayout', () => {
  it('keeps the old defaults when there is no layout', () => {
    const result = applyLayout(clip(), {}, frame);
    expect(result.bottom).toBe('video');
    expect(result.crop).toBeUndefined();
  });

  it('puts the face on top and the live below for a corner camera', () => {
    const result = applyLayout(clip(), { camera: 'bottom-left', bottom: 'source' }, frame);
    expect(result.bottom).toBe('source');
    expect(result.crop).toEqual({ x: 0, y: 648, w: 486, h: 432 });
  });

  it('converts a percent camera to pixels of the real frame', () => {
    const result = applyLayout(clip(), { camera: '0.7,2.8,17.5,27.6' }, frame);
    expect(result.crop).toEqual({ x: 13, y: 30, w: 336, h: 298 });
  });

  it('never overrides what the clip already decided', () => {
    const own = clip({ bottom: 'video', crop: { x: 1, y: 2, w: 300, h: 266 } });
    const result = applyLayout(own, { camera: 'top-right', bottom: 'source' }, frame);
    expect(result.bottom).toBe('video');
    expect(result.crop).toEqual({ x: 1, y: 2, w: 300, h: 266 });
  });

  it('crops the bottom half to an area only when it shows the source', () => {
    const podcast = applyLayout(
      clip(),
      { camera: '0,0,63.3,100', bottom: 'source', bottomArea: '36.7,0,63.3,100' },
      frame,
    );
    expect(podcast.crop).toEqual({ x: 0, y: 0, w: 1215, h: 1080 });
    expect(podcast.bottomCrop).toEqual({ x: 705, y: 0, w: 1215, h: 1080 });
    const trailer = applyLayout(clip(), { bottom: 'video', bottomArea: '36.7,0,63.3,100' }, frame);
    expect(trailer.bottomCrop).toBeUndefined();
  });

  it('lets none turn the camera crop off', () => {
    expect(applyLayout(clip(), { camera: 'none' }, frame).crop).toBeUndefined();
  });

  it('rejects an invalid camera instead of ignoring it', () => {
    expect(() => applyLayout(clip(), { camera: 'meio' }, frame)).toThrow();
  });

  it('merges workspace over default and skips undefined values', () => {
    expect(
      mergeLayouts(
        { bottom: 'source', camera: undefined },
        { camera: 'top-left', bottom: 'video' },
      ),
    ).toEqual({ camera: 'top-left', bottom: 'source' });
    expect(mergeLayouts(null, { cameraSize: 30 })).toEqual({ cameraSize: 30 });
  });
});

describe('LayoutService', () => {
  let dir = '';
  let saved: { layout: object };
  let service: LayoutService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-layout-'));
    saved = { layout: {} };
    const config = {
      load: () => Promise.resolve(saved),
      update: (patch: { layout: object }) => {
        saved = { ...saved, ...patch };
        return Promise.resolve(saved);
      },
    } as unknown as UserConfigStore;
    service = new LayoutService(config);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('saves per video and reports the effective layout with the global default under it', async () => {
    const workspace = new Workspace(dir);
    await service.saveDefault({ bottom: 'video', camera: 'top-left' });
    const view = await service.saveForWorkspace(workspace, { bottom: 'source' });
    expect(view.workspace).toEqual({ bottom: 'source' });
    expect(view.effective).toEqual({ camera: 'top-left', bottom: 'source' });
  });

  it('refuses an invalid camera when saving', async () => {
    await expect(service.saveDefault({ camera: 'meio' })).rejects.toThrow();
    await expect(
      service.saveForWorkspace(new Workspace(dir), { camera: '1,2,3' }),
    ).rejects.toThrow();
  });

  it('clears the video layout and the default', async () => {
    const workspace = new Workspace(dir);
    await service.saveForWorkspace(workspace, { bottom: 'source' });
    expect((await service.clearWorkspace(workspace)).workspace).toBeNull();
    await service.saveDefault({ bottom: 'source' });
    expect((await service.clearDefault()).default).toEqual({});
  });
});
