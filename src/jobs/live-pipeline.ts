import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { resolveInside } from '../common/safe-path.js';
import { AppPaths } from '../config/app-paths.js';
import { UserConfigStore } from '../config/user-config.js';
import type { JobRequest } from '../contracts/job.js';
import { parseCamera } from '../layout/camera.js';
import { LiveService } from '../live/live.service.js';
import { NicheRegistry } from '../niches/niche-registry.js';
import type { Pipeline, PipelineContext } from './pipeline-context.js';
import { bottomPlan, DEFAULT_CAMERA, rectSpec, type BottomPlan, type Preset } from './presets.js';
import { SelectorClients } from './selector-client.js';
import type { JobStepId } from './step-tracker.js';

const JUDGE_MIN_SCORE = 5;
const MAX_HEIGHT = 1080;

@Injectable()
export class LivePipeline implements Pipeline {
  constructor(
    private readonly live: LiveService,
    private readonly clients: SelectorClients,
    private readonly niches: NicheRegistry,
    private readonly config: UserConfigStore,
    private readonly paths: AppPaths,
  ) {}

  steps(request: JobRequest, preset: Preset): JobStepId[] {
    return [
      ...(preset.camera === 'ask' && request.camera === undefined ? (['camera'] as const) : []),
      'live',
    ];
  }

  private async liveBottom(plan: BottomPlan): Promise<string | null> {
    if (plan.kind === 'source') return null;
    if (plan.kind === 'url') return plan.url;
    return uploadedFile(this.paths.uploadsDir, plan.uploadId);
  }

  async run(context: PipelineContext): Promise<Record<string, unknown>> {
    const { request, preset, workspace, tracker } = context;
    if (request.source.type !== 'live') throw new Error('fonte não é uma live');
    const link = request.source.url;
    await workspace.ensure();
    let camera = request.camera;
    if (tracker.has('camera')) {
      tracker.start('camera', 'tirando uma foto da live');
      const frame = workspace.file('frame-camera.jpg');
      await this.live.snapshot(link, frame, MAX_HEIGHT);
      tracker.wait('camera', 'marque onde está o rosto');
      camera = await context.waitForCamera(path.basename(frame), DEFAULT_CAMERA);
      tracker.finish('camera');
    }
    const niche = this.niches.get(preset.niche);
    const cameraSpec =
      preset.camera === 'ask' && camera !== undefined
        ? parseCamera(rectSpec(camera), 40)
        : preset.layout.camera !== undefined && preset.layout.camera !== 'none'
          ? parseCamera(preset.layout.camera, 40)
          : null;
    const client = await this.clients.forSelector(request.selector);
    const settings = await this.config.load();
    let produced = 0;
    context.listen((name, data) => {
      if (name === 'clip') {
        const files = Array.isArray(data.files) ? data.files.filter(isText) : [];
        const id = typeof data.id === 'string' ? data.id : 'corte';
        const hook = typeof data.hook === 'string' ? data.hook : null;
        for (const file of files) {
          produced += 1;
          void context.addClip({
            file,
            clipId: id,
            title: hook ?? id,
            hook,
            score: typeof data.judgeScore === 'number' ? Math.round(data.judgeScore) : null,
            account: accountOf(file, context.outDir),
          });
        }
        tracker.update('live', null, `${String(produced)} cortes prontos`);
        return;
      }
      if (name === 'skip') {
        context.log(
          'info',
          `momento descartado: ${typeof data.reason === 'string' ? data.reason : ''}`,
        );
        return;
      }
      if (name === 'ad') {
        tracker.update('live', null, data.active === true ? 'intervalo comercial' : 'live no ar');
        return;
      }
      if (name === 'error') {
        context.log('error', typeof data.message === 'string' ? data.message : 'erro na live');
      }
    });
    tracker.start('live', 'conectando na live');
    const targets = request.targets;
    const summary = await this.live.run(
      {
        link,
        outDir: context.outDir,
        accounts: request.accounts ?? [],
        bottom: await this.liveBottom(bottomPlan(preset, request.bottom, niche.defaultBottomUrl)),
        language: settings.language,
        model: undefined,
        detector:
          targets.mode === 'duration'
            ? { minSeconds: targets.minSeconds, maxSeconds: targets.maxSeconds }
            : {},
        maxHeight: MAX_HEIGHT,
        maxPerHour: 12,
        maxClips: targets.mode === 'count' ? targets.count : 0,
        offlineWait: 120,
        keepSeconds: 600,
        minWords: 12,
        maxQueue: 3,
        keepWork: false,
        chat: true,
        judge:
          client === null
            ? null
            : { minScore: JUDGE_MIN_SCORE, niche: `${niche.label}: ${niche.summary}`, client },
        enqueue: null,
        camera: cameraSpec,
        credit: null,
      },
      context.signal,
    );
    tracker.finish('live', `${String(summary.produced)} cortes prontos`);
    return { ...summary };
  }
}

async function uploadedFile(uploads: string, uploadId: string): Promise<string> {
  const names = await fs.readdir(uploads).catch(() => []);
  const name = names.find((item) => item.startsWith(`${uploadId}.`));
  if (name === undefined)
    throw new AppError('MISSING_FILE', 'o vídeo de baixo enviado não existe mais');
  return resolveInside(uploads, name);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function accountOf(file: string, outDir: string): string | null {
  const folder = path.dirname(path.resolve(file));
  return folder === path.resolve(outDir) ? null : path.basename(folder);
}
