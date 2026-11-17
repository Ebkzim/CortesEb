import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { AppPaths } from '../config/app-paths.js';
import { SPLIT_CUT_COMPOSITION, type SplitCutProps } from '../contracts/render.js';
import type { RenderEngine, RenderSession } from './render-engine.js';

const CRF = 20;

@Injectable()
export class RemotionEngine implements RenderEngine {
  constructor(private readonly paths: AppPaths) {}

  async ensureBrowser(): Promise<void> {
    await ensureBrowser({ logLevel: 'error' });
  }

  async open(publicDir: string): Promise<RenderSession> {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-'));
    const serveUrl = await bundle({
      entryPoint: this.paths.remotionEntry,
      rootDir: this.paths.packageRoot,
      outDir,
      publicDir,
      symlinkPublicDir: true,
      enableCaching: true,
    });
    return {
      serveUrl,
      dispose: () => fs.rm(outDir, { recursive: true, force: true }),
    };
  }

  async render(session: RenderSession, props: SplitCutProps, output: string): Promise<void> {
    const composition = await selectComposition({
      serveUrl: session.serveUrl,
      id: SPLIT_CUT_COMPOSITION,
      inputProps: props,
      logLevel: 'error',
    });
    await renderMedia({
      composition,
      serveUrl: session.serveUrl,
      codec: 'h264',
      crf: CRF,
      outputLocation: output,
      inputProps: props,
      logLevel: 'error',
    });
  }
}
