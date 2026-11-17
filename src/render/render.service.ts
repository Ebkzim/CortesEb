import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AccountService, type AccountView } from '../accounts/account.service.js';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { Progress, throttled } from '../common/progress.js';
import { resolveInside } from '../common/safe-path.js';
import { UserConfigStore } from '../config/user-config.js';
import { cutsSchema, type Clip } from '../contracts/cuts.js';
import { captionsSchema, silencesSchema, sourceMetaSchema } from '../contracts/media.js';
import type { RenderWatermark } from '../contracts/render.js';
import { applyLayout } from '../layout/layout.js';
import { LayoutService } from '../layout/layout.service.js';
import { MediaTools } from '../media/media-tools.js';
import { TargetsService } from '../planning/targets.service.js';
import { SFX_NAMES, SfxLibrary } from '../sfx/sfx-library.js';
import { dropMarkers } from '../transcription/tokens.js';
import type { Workspace } from '../workspace/workspace.js';
import { ClipComposer, type RenderContext } from './clip-composer.js';
import { FfmpegEngine } from './ffmpeg/ffmpeg-engine.js';
import type { EngineName, RenderEngine } from './render-engine.js';
import { RemotionEngine } from './remotion-engine.js';
import type { StagedSounds } from './sound-plan.js';

export interface ClipResult {
  id: string;
  account: string | null;
  file: string;
  seconds: number;
  ok: boolean;
  warnings: string[];
  error?: string;
}

interface Target {
  account: AccountView | null;
  watermark: RenderWatermark | null;
}

const NO_ACCOUNT: Target = { account: null, watermark: null };

@Injectable()
export class RenderService {
  constructor(
    private readonly config: UserConfigStore,
    private readonly accounts: AccountService,
    private readonly targets: TargetsService,
    private readonly media: MediaTools,
    private readonly sfx: SfxLibrary,
    private readonly composer: ClipComposer,
    private readonly fast: FfmpegEngine,
    private readonly remotion: RemotionEngine,
    private readonly progress: Progress,
    private readonly layouts: LayoutService,
  ) {}

  async run(
    workspace: Workspace,
    outDir: string,
    requested: readonly string[] | undefined,
    engineName: EngineName = 'fast',
  ): Promise<ClipResult[]> {
    const engine: RenderEngine = engineName === 'fast' ? this.fast : this.remotion;
    const cuts = await readJson(workspace.cuts, cutsSchema);
    const layout = await this.layouts.effective(workspace);
    const frame = await readJson(workspace.meta, sourceMetaSchema);
    const clips = cuts.clips.map((clip) => applyLayout(clip, layout, frame));
    const plan = await this.planTargets(clips, requested, workspace);
    const context = await this.buildContext(
      workspace,
      clips.some((clip) => clip.bottom === 'video' && clip.frame !== 'fit'),
    );
    await this.targets.assert(workspace);
    const base = path.resolve(outDir);
    const session = await engine.open(workspace.root);
    const results: ClipResult[] = [];
    const total = Math.max(
      1,
      clips.reduce((sum, clip) => sum + (plan.get(clip.id)?.length ?? 0), 0),
    );
    let done = 0;
    try {
      for (const [index, clip] of clips.entries()) {
        const composed = await this.composer.compose(clip, index, context);
        const seconds = Number(composed.props.totalSeconds.toFixed(1));
        for (const target of plan.get(clip.id) ?? []) {
          const account = target.account?.id ?? null;
          const folder = account === null ? base : resolveInside(base, account);
          const file = resolveInside(folder, `${clip.id}.mp4`);
          const props = { ...composed.props, watermark: target.watermark };
          await fs.mkdir(folder, { recursive: true });
          await writeJson(workspace.file(`props-${clip.id}-${account ?? 'sem-conta'}.json`), props);
          const position = done;
          const report = throttled((fraction: number) => {
            this.progress.step(
              'render',
              (position + fraction) / total,
              `renderizando ${clip.id} para ${account ?? 'sem conta'} (${seconds} s)`,
            );
          });
          report(0);
          const result = { id: clip.id, account, file, seconds };
          try {
            await engine.render(session, props, file, report);
            results.push({ ...result, ok: true, warnings: composed.warnings });
            this.progress.event('rendered', { id: clip.id, account, file });
          } catch (error) {
            results.push({
              ...result,
              ok: false,
              warnings: composed.warnings,
              error: error instanceof Error ? firstLine(error.message) : 'falha no render',
            });
          }
          done += 1;
        }
      }
    } finally {
      await session.dispose();
    }
    return results;
  }

  private async planTargets(
    clips: readonly Clip[],
    requested: readonly string[] | undefined,
    workspace: Workspace,
  ): Promise<Map<string, Target[]>> {
    const staged = new Map<string, Target>();
    const plan = new Map<string, Target[]>();
    for (const clip of clips) {
      const targets: Target[] = [];
      for (const account of await this.accounts.resolve(clip.accounts ?? requested)) {
        let target = staged.get(account.id);
        if (target === undefined) {
          target = { account, watermark: await this.stageWatermark(account, workspace) };
          staged.set(account.id, target);
        }
        targets.push(target);
      }
      plan.set(clip.id, targets.length > 0 ? targets : [NO_ACCOUNT]);
    }
    return plan;
  }

  private async stageWatermark(
    account: AccountView,
    workspace: Workspace,
  ): Promise<RenderWatermark | null> {
    const source = await this.accounts.logoFile(account);
    if (source === null && account.name === null) return null;
    if (source === null || account.logo === null) return { logo: null, name: account.name };
    const logo = `wm-${account.logo}`;
    await workspace.ensure();
    await fs.copyFile(source, workspace.file(logo));
    return { logo, name: account.name };
  }

  private async buildContext(workspace: Workspace, needsBottom: boolean): Promise<RenderContext> {
    const roles = needsBottom ? (['source', 'bottom'] as const) : (['source'] as const);
    for (const role of roles) {
      if (!(await exists(workspace.video(role)))) {
        throw new AppError('MISSING_FILE', `falta o ${role}.mp4 na pasta de trabalho`);
      }
    }
    const config = await this.config.load();
    return {
      workspace,
      words: dropMarkers(await readJson(workspace.captions, captionsSchema)),
      silences: await readJson(workspace.silences, silencesSchema),
      meta: await readJson(workspace.meta, sourceMetaSchema),
      sourceDuration: await this.media.duration(workspace.video('source')),
      bottomDuration: needsBottom ? await this.media.duration(workspace.video('bottom')) : 0,
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
