import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { Output } from '../common/output.js';
import { resolveInside } from '../common/safe-path.js';
import { AppPaths } from '../config/app-paths.js';
import { UserConfigStore, type UserConfig } from '../config/user-config.js';
import { cutsSchema } from '../contracts/cuts.js';
import { captionsSchema, silencesSchema, sourceMetaSchema } from '../contracts/media.js';
import { MediaTools } from '../media/media-tools.js';
import { SFX_NAMES, SfxLibrary } from '../sfx/sfx-library.js';
import type { Workspace } from '../workspace/workspace.js';
import { ClipComposer, type RenderContext } from './clip-composer.js';
import { RemotionEngine } from './remotion-engine.js';
import type { StagedSounds } from './sound-plan.js';

export interface ClipResult {
  id: string;
  file: string;
  seconds: number;
  ok: boolean;
  warnings: string[];
  error?: string;
}

@Injectable()
export class RenderService {
  constructor(
    private readonly paths: AppPaths,
    private readonly config: UserConfigStore,
    private readonly media: MediaTools,
    private readonly sfx: SfxLibrary,
    private readonly composer: ClipComposer,
    private readonly engine: RemotionEngine,
    private readonly output: Output,
  ) {}

  async run(workspace: Workspace, outDir: string): Promise<ClipResult[]> {
    const config = await this.config.load();
    const cuts = await readJson(workspace.cuts, cutsSchema);
    const context = await this.buildContext(workspace, config);
    const target = path.resolve(outDir);
    await fs.mkdir(target, { recursive: true });
    const session = await this.engine.open(workspace.root);
    const results: ClipResult[] = [];
    try {
      for (const [index, clip] of cuts.clips.entries()) {
        const file = resolveInside(target, `${clip.id}.mp4`);
        const composed = await this.composer.compose(clip, index, context);
        const seconds = Number(composed.props.totalSeconds.toFixed(1));
        await writeJson(workspace.file(`props-${clip.id}.json`), composed.props);
        this.output.info(`> renderizando ${clip.id} (${seconds} s)`);
        try {
          await this.engine.render(session, composed.props, file);
          results.push({ id: clip.id, file, seconds, ok: true, warnings: composed.warnings });
        } catch (error) {
          results.push({
            id: clip.id,
            file,
            seconds,
            ok: false,
            warnings: composed.warnings,
            error: error instanceof Error ? firstLine(error.message) : 'falha no render',
          });
        }
      }
    } finally {
      await session.dispose();
    }
    return results;
  }

  private async buildContext(workspace: Workspace, config: UserConfig): Promise<RenderContext> {
    if (config.profileName === undefined || config.logo === undefined) {
      throw new AppError('NOT_CONFIGURED', 'perfil não configurado: rode cortes-eb profile');
    }
    for (const role of ['source', 'bottom'] as const) {
      if (!(await exists(workspace.video(role)))) {
        throw new AppError('MISSING_FILE', `falta o ${role}.mp4 na pasta de trabalho`);
      }
    }
    const logo = `wm-${config.logo}`;
    await fs.copyFile(this.paths.inHome(config.logo), workspace.file(logo));
    return {
      workspace,
      words: await readJson(workspace.captions, captionsSchema),
      silences: await readJson(workspace.silences, silencesSchema),
      meta: await readJson(workspace.meta, sourceMetaSchema),
      sourceDuration: await this.media.duration(workspace.video('source')),
      bottomDuration: await this.media.duration(workspace.video('bottom')),
      watermark: { logo, name: config.profileName },
      sounds: await this.stageSounds(workspace),
      sfxGain: config.sfxGain,
    };
  }

  private async stageSounds(workspace: Workspace): Promise<StagedSounds> {
    const staged: StagedSounds = {};
    for (const name of SFX_NAMES) {
      const source = await this.sfx.locate(name);
      if (source === null) continue;
      const file = `sfx-${name}${path.extname(source)}`;
      await fs.copyFile(source, workspace.file(file));
      staged[name] = file;
    }
    return staged;
  }
}

function firstLine(message: string): string {
  return message.split(/\r?\n/)[0]?.slice(0, 300) ?? 'falha no render';
}
