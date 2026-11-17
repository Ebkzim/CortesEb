import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson } from '../common/json-file.js';
import { resolveInside } from '../common/safe-path.js';
import { AppPaths } from '../config/app-paths.js';
import { UserConfigStore } from '../config/user-config.js';
import { cutsSchema } from '../contracts/cuts.js';
import type { JobRequest, JobSource, PercentRect } from '../contracts/job.js';
import { VideoFetcher } from '../download/video-fetcher.js';
import { LayoutService } from '../layout/layout.service.js';
import { MediaTools } from '../media/media-tools.js';
import { NicheRegistry } from '../niches/niche-registry.js';
import { TargetsService, type TargetsInput } from '../planning/targets.service.js';
import { RenderService } from '../render/render.service.js';
import { SelectorService } from '../select/selector.service.js';
import { TranscriptionService } from '../transcription/transcription.service.js';
import { Workspace } from '../workspace/workspace.js';
import { buildAgentPrompt } from './agent-prompt.js';
import { assertActive, pause, type Pipeline, type PipelineContext } from './pipeline-context.js';
import { DEFAULT_CAMERA, layoutFor, type Preset } from './presets.js';
import { SelectorClients } from './selector-client.js';
import type { JobStepId } from './step-tracker.js';

const AGENT_POLL_MS = 3000;
const REUSABLE = [
  'source.mp4',
  'bottom.mp4',
  'meta.json',
  'origin.json',
  'captions.json',
  'silences.json',
  'audio16k.wav',
  'layout.json',
] as const;
const CAMERA_FRAME_WIDTH = 960;
const MIN_SCORE = 6;
const CHUNK_SECONDS = 360;
const WHISPER_FACTOR = 3;
const RENDER_FACTOR = 3;
const SECONDS_PER_CHUNK = { ollama: 240, api: 25 } as const;

export function targetsInput(request: JobRequest): TargetsInput {
  return request.targets.mode === 'count'
    ? { count: request.targets.count }
    : { minSeconds: request.targets.minSeconds, maxSeconds: request.targets.maxSeconds };
}

export function youtubeLink(source: JobSource): string | null {
  if (source.type === 'youtube') return source.url;
  if (source.type === 'vod' && source.platform === 'youtube') {
    return source.from === undefined && source.to === undefined ? source.url : null;
  }
  return null;
}

@Injectable()
export class CutPipeline implements Pipeline {
  constructor(
    private readonly paths: AppPaths,
    private readonly config: UserConfigStore,
    private readonly fetcher: VideoFetcher,
    private readonly media: MediaTools,
    private readonly transcription: TranscriptionService,
    private readonly targets: TargetsService,
    private readonly selector: SelectorService,
    private readonly clients: SelectorClients,
    private readonly renderer: RenderService,
    private readonly layouts: LayoutService,
    private readonly niches: NicheRegistry,
  ) {}

  steps(request: JobRequest, preset: Preset): JobStepId[] {
    return [
      'download',
      ...(preset.bottom === 'niche' ? (['bottom'] as const) : []),
      ...(preset.camera === 'ask' && request.camera === undefined ? (['camera'] as const) : []),
      'transcribe',
      'select',
      'render',
      'organize',
    ];
  }

  async run(context: PipelineContext): Promise<Record<string, unknown>> {
    const { request, preset, workspace, tracker, signal } = context;
    await workspace.ensure();
    tracker.estimate('download', 60);
    tracker.estimate('organize', 5);

    const reused = await this.reuse(request.resume, workspace);
    if (reused.source) {
      tracker.finish('download', 'reaproveitado da tentativa anterior');
    } else {
      tracker.start('download', 'buscando o vídeo');
      await this.fetchSource(request.source, workspace);
    }
    const meta = await this.media.probe(workspace.video('source'));
    if (!reused.source) tracker.finish('download', `vídeo de ${formatSeconds(meta.duration)}`);
    assertActive(signal);

    if (tracker.has('bottom')) {
      if (reused.bottom) {
        tracker.finish('bottom', 'reaproveitado');
      } else {
        tracker.start('bottom', 'buscando o vídeo de baixo');
        await this.prepareBottom(preset, workspace);
        tracker.finish('bottom');
      }
      assertActive(signal);
    }

    const youtube = youtubeLink(request.source);
    const chunks = Math.max(1, Math.ceil(meta.duration / CHUNK_SECONDS));
    tracker.estimate('transcribe', youtube === null ? meta.duration * WHISPER_FACTOR : 30);
    tracker.estimate(
      'select',
      request.selector.kind === 'agent'
        ? null
        : chunks * SECONDS_PER_CHUNK[request.selector.kind === 'ollama' ? 'ollama' : 'api'],
    );

    let camera = request.camera;
    if (reused.layout) {
      if (tracker.has('camera')) tracker.skip('camera', 'enquadramento reaproveitado');
    } else if (tracker.has('camera')) {
      const frame = workspace.file('frame-camera.jpg');
      await this.media.frame(
        workspace.video('source'),
        Math.min(30, meta.duration / 3),
        frame,
        CAMERA_FRAME_WIDTH,
      );
      tracker.wait('camera', 'marque onde está o rosto');
      camera = await context.waitForCamera(path.basename(frame), DEFAULT_CAMERA);
      tracker.finish('camera');
    }
    if (!reused.layout) await this.layouts.saveForWorkspace(workspace, layoutFor(preset, camera));
    assertActive(signal);

    if (reused.transcript) {
      tracker.finish('transcribe', 'transcrição reaproveitada');
    } else {
      tracker.start('transcribe', 'preparando a transcrição');
      await this.transcribe(youtube, workspace, context);
      tracker.finish('transcribe');
    }
    assertActive(signal);

    const plan = await this.targets.define(workspace, targetsInput(request));
    const averageClip = (plan.minSeconds + plan.maxSeconds) / 2;
    tracker.estimate('render', plan.count * averageClip * RENDER_FACTOR);
    tracker.start('select', 'lendo a transcrição');
    await this.select(context, plan);
    tracker.finish('select');
    assertActive(signal);

    const fitted = await this.targets.fitDurations(workspace);
    if (fitted.widened) {
      context.log(
        'warn',
        'o plano foi ajustado aos cortes escolhidos (quantidade ou duração diferentes do pedido)',
      );
    }
    const cuts = await readJson(workspace.cuts, cutsSchema);
    tracker.start('render', `${String(cuts.clips.length)} cortes para renderizar`);
    const results = await this.renderer.run(workspace, context.outDir, request.accounts, 'fast');
    const failed = results.filter((result) => !result.ok);
    for (const result of failed) {
      context.log('error', `o corte ${result.id} falhou: ${result.error ?? 'erro no render'}`);
    }
    if (results.length > 0 && failed.length === results.length) {
      throw new AppError('PROCESS_FAILED', 'nenhum corte conseguiu ser renderizado');
    }
    tracker.finish('render');

    tracker.start('organize', 'guardando em Meus clipes');
    for (const result of results.filter((item) => item.ok)) {
      const clip = cuts.clips.find((item) => item.id === result.id);
      await context.addClip({
        file: result.file,
        clipId: result.id,
        title: clip?.title ?? clip?.hook ?? result.id,
        hook: clip?.hook ?? null,
        score: clip?.score ?? null,
        account: result.account,
      });
    }
    tracker.finish('organize');
    return {
      clips: results.filter((item) => item.ok).length,
      failed: failed.length,
      seconds: Math.round(meta.duration),
    };
  }

  private async reuse(
    previous: string | undefined,
    workspace: Workspace,
  ): Promise<{ source: boolean; bottom: boolean; transcript: boolean; layout: boolean }> {
    const none = { source: false, bottom: false, transcript: false, layout: false };
    if (previous === undefined) return none;
    const old = new Workspace(path.join(this.paths.jobsDir, previous, 'work'));
    const carried = new Set<string>();
    for (const name of REUSABLE) {
      const from = old.file(name);
      if (!(await exists(from))) continue;
      const to = workspace.file(name);
      await fs.rm(to, { force: true });
      await fs.link(from, to).catch(() => fs.copyFile(from, to));
      carried.add(name);
    }
    return {
      source: carried.has('source.mp4') && carried.has('meta.json'),
      bottom: carried.has('bottom.mp4'),
      transcript: carried.has('captions.json') && carried.has('silences.json'),
      layout: carried.has('layout.json'),
    };
  }

  private async fetchSource(source: JobSource, workspace: Workspace): Promise<void> {
    switch (source.type) {
      case 'file':
        await this.fetcher.fetch(await this.uploadPath(source.uploadId), 'source', workspace);
        return;
      case 'youtube':
        await this.fetcher.fetch(source.url, 'source', workspace);
        return;
      case 'vod': {
        const section =
          source.from === undefined && source.to === undefined
            ? undefined
            : { from: source.from ?? 0, to: source.to ?? Number.MAX_SAFE_INTEGER };
        if (section !== undefined && source.to === undefined) {
          throw new AppError('INVALID_INPUT', 'informe o fim do trecho junto com o início');
        }
        await this.fetcher.fetch(source.url, 'source', workspace, section);
        return;
      }
      case 'live':
        throw new AppError('INVALID_INPUT', 'uma live usa o fluxo de live');
    }
  }

  private async uploadPath(uploadId: string): Promise<string> {
    const names = await fs.readdir(this.paths.uploadsDir).catch(() => []);
    const name = names.find((item) => item.startsWith(`${uploadId}.`));
    if (name === undefined) throw new AppError('MISSING_FILE', 'o arquivo enviado não existe mais');
    return resolveInside(this.paths.uploadsDir, name);
  }

  private async prepareBottom(preset: Preset, workspace: Workspace): Promise<void> {
    const url = this.niches.get(preset.niche).defaultBottomUrl;
    if (url === null)
      throw new AppError('NOT_CONFIGURED', 'esse tipo não tem vídeo de baixo padrão');
    const key = createHash('sha256').update(url).digest('hex').slice(0, 16);
    const cache = new Workspace(path.join(this.paths.cacheDir, 'bottom', key));
    if (!(await exists(cache.video('bottom')))) {
      await this.fetcher.fetch(url, 'bottom', cache);
    }
    const target = workspace.video('bottom');
    await fs.rm(target, { force: true });
    await fs
      .link(cache.video('bottom'), target)
      .catch(() => fs.copyFile(cache.video('bottom'), target));
  }

  private async transcribe(
    youtube: string | null,
    workspace: Workspace,
    context: PipelineContext,
  ): Promise<void> {
    const settings = await this.config.load();
    if (youtube !== null) {
      const language = settings.language === 'auto' ? 'pt' : settings.language;
      try {
        await this.transcription.fromYoutube(workspace, language, youtube);
        return;
      } catch (error) {
        context.log(
          'warn',
          `sem legenda do YouTube (${describe(error)}); transcrevendo com o whisper`,
        );
      }
    }
    await this.transcription.run(workspace, {});
  }

  private async select(
    context: PipelineContext,
    plan: { count: number; minSeconds: number; maxSeconds: number },
  ): Promise<void> {
    const { request, preset, workspace } = context;
    const niche = this.niches.get(preset.niche);
    if (request.selector.kind === 'agent') {
      await this.waitForAgent(
        context,
        request.selector.agent,
        plan,
        `${niche.label}: ${niche.summary}`,
      );
      return;
    }
    const client = await this.clients.forSelector(request.selector);
    if (client === null)
      throw new AppError('INVALID_INPUT', 'escolha quem vai selecionar os cortes');
    const result = await this.selector.run(workspace, {
      llm: {},
      client,
      targets: targetsInput(request),
      niche: `${niche.label}: ${niche.summary}`,
      minScore: MIN_SCORE,
      chunk: {},
      fallback: true,
    });
    for (const warning of result.warnings) context.log('warn', warning);
  }

  private async waitForAgent(
    context: PipelineContext,
    agent: 'claude' | 'codex',
    plan: { count: number; minSeconds: number; maxSeconds: number },
    niche: string,
  ): Promise<void> {
    const { workspace, tracker, signal } = context;
    const prompt = buildAgentPrompt({
      agent,
      workDir: workspace.root,
      targets: plan,
      preset: context.preset.label,
      niche,
    });
    await fs.rm(workspace.cuts, { force: true });
    tracker.wait(
      'select',
      `esperando o ${agent === 'claude' ? 'Claude' : 'Codex'} escolher os cortes`,
    );
    let problems: string[] = [];
    await context.setWaiting({ kind: 'agent', agent, prompt, workDir: workspace.root, problems });
    for (;;) {
      assertActive(signal);
      if (await exists(workspace.cuts)) {
        const check = await this.targets.check(workspace).catch((error: unknown) => ({
          ok: false,
          problems: [describe(error)],
          clips: [] as { ok: boolean; id: string; problem?: string }[],
        }));
        if (check.ok) break;
        const next = [
          ...check.problems,
          ...check.clips
            .filter((clip) => !clip.ok)
            .map((clip) => `${clip.id}: ${clip.problem ?? ''}`),
        ];
        if (next.join('|') !== problems.join('|')) {
          problems = next;
          await context.setWaiting({
            kind: 'agent',
            agent,
            prompt,
            workDir: workspace.root,
            problems,
          });
        }
      }
      await pause(AGENT_POLL_MS, signal);
    }
    await context.setWaiting(null);
  }
}

export function suggestionFor(camera: PercentRect | undefined): PercentRect {
  return camera ?? DEFAULT_CAMERA;
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? 'erro') : 'erro';
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = Math.round(total % 60);
  return minutes > 0 ? `${String(minutes)} min ${String(seconds)} s` : `${String(seconds)} s`;
}
