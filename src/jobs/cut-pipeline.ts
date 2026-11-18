import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { resolveInside } from '../common/safe-path.js';
import { AppPaths } from '../config/app-paths.js';
import { UserConfigStore } from '../config/user-config.js';
import { withScaledProgress } from '../common/progress.js';
import { cutsSchema, type Clip } from '../contracts/cuts.js';
import type { Word } from '../contracts/media.js';
import type { ClipResult } from '../render/render.service.js';
import { pickBest, snap, toClip, type Limits } from '../select/candidates.js';
import type { Candidate } from '../select/prompt.js';
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
import { CameraMemory } from './camera-memory.js';
import { assertActive, pause, type Pipeline, type PipelineContext } from './pipeline-context.js';
import {
  bottomPlan,
  DEFAULT_CAMERA,
  layoutFor,
  withBottom,
  type BottomPlan,
  type Preset,
} from './presets.js';
import { buildGuidance, introSeconds } from '../select/guidance.js';
import { SelectorClients } from './selector-client.js';
import { SpeedBook } from './speed-book.js';
import { StageGates, type Stage } from './stage-gates.js';
import type { JobStepId } from './step-tracker.js';

const AGENT_POLL_MS = 3000;
const ATTENTION_PRESETS = new Set(['gameplay-camera', 'react', 'filmes', 'series']);
const REUSABLE = [
  'source.mp4',
  'bottom.mp4',
  'meta.json',
  'origin.json',
  'captions.json',
  'silences.json',
  'audio16k.wav',
  'layout.json',
  'transcribed.json',
] as const;
const CAMERA_FRAME_WIDTH = 960;
const MIN_KEPT_SHARE = 0.7;
const MIN_SPOKEN_WORDS = 10;
const MIN_SCORE = 6;
const CHUNK_SECONDS = 360;
const WHISPER_FACTOR = 3;
const RENDER_FACTOR = 3;
const SECONDS_PER_CHUNK = { ollama: 240, api: 25 } as const;
const STRIP_FRAMES = 8;
const STRIP_WIDTH = 320;
const PROGRESSIVE_FROM = 15 * 60;
const FIRST_WAVE_SECONDS = 300;
const WAVE_SECONDS = 600;
const EARLY_SCORE = 8.5;
const EARLY_EXTRA = 1;
const LOCAL_CHUNK = { chunkSeconds: 240, overlapSeconds: 30 };

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
    private readonly speed: SpeedBook,
    private readonly gates: StageGates,
    private readonly cameras: CameraMemory,
  ) {}

  steps(request: JobRequest, preset: Preset): JobStepId[] {
    return [
      'download',
      ...(this.bottomOf(request, preset).kind === 'source' ? [] : (['bottom'] as const)),
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
    tracker.estimate('download', await this.speed.rate('download', 60));
    tracker.estimate('organize', 5);

    const reused = await this.reuse(request.resume, workspace);
    if (reused.source) {
      tracker.finish('download', 'reaproveitado da tentativa anterior');
    } else {
      await this.gate(context, 'download', 'download', 'na fila para baixar', async () => {
        tracker.start('download', 'buscando o vídeo');
        const started = Date.now();
        await this.fetchSource(request.source, workspace);
        await this.speed.record('download', (Date.now() - started) / 1000, 1);
      });
    }
    const meta = await this.media.probe(workspace.video('source'));
    if (!reused.source) tracker.finish('download', `vídeo de ${formatSeconds(meta.duration)}`);
    assertActive(signal);

    if (tracker.has('bottom')) {
      if (reused.bottom) {
        tracker.finish('bottom', 'reaproveitado');
      } else {
        await this.gate(context, 'download', 'bottom', 'na fila para baixar', async () => {
          tracker.start('bottom', 'buscando o vídeo de baixo');
          await this.prepareBottom(this.bottomOf(request, preset), workspace);
        });
        tracker.finish('bottom');
      }
      assertActive(signal);
    }

    const youtube = youtubeLink(request.source);
    const settings = await this.config.load();
    const whisperKey = `transcribe:whisper-${settings.whisperModel}`;
    tracker.estimate(
      'transcribe',
      youtube === null
        ? await this.speed.estimate(whisperKey, meta.duration, WHISPER_FACTOR)
        : await this.speed.rate('transcribe:captions', 30),
    );
    const chunks = Math.max(1, Math.ceil(meta.duration / CHUNK_SECONDS));
    const selectKey = selectSpeedKey(request);
    tracker.estimate(
      'select',
      selectKey === null
        ? null
        : await this.speed.estimate(
            selectKey,
            chunks,
            SECONDS_PER_CHUNK[request.selector.kind === 'ollama' ? 'ollama' : 'api'],
          ),
    );

    let camera = request.camera;
    if (reused.layout) {
      if (tracker.has('camera')) tracker.skip('camera', 'enquadramento reaproveitado');
    } else if (tracker.has('camera')) {
      tracker.start('camera', 'separando quadros do vídeo');
      const choice = await this.cameraFrames(workspace, meta.duration);
      tracker.wait('camera', 'marque onde está o rosto');
      camera = await context.waitForCamera(
        choice.frame,
        await this.cameras.recall(request, DEFAULT_CAMERA),
        { duration: meta.duration, at: choice.at, strip: choice.strip },
      );
      await this.cameras.remember(request, camera);
      tracker.finish('camera');
    }
    if (!reused.layout)
      await this.layouts.saveForWorkspace(
        workspace,
        withBottom(layoutFor(preset, camera), this.bottomOf(request, preset)),
      );
    assertActive(signal);

    if (request.selector.kind === 'agent') {
      return this.runWithAgent(context, meta.duration, reused.transcript, youtube, whisperKey);
    }
    return this.deliver(context, meta.duration, reused.transcript, youtube, whisperKey);
  }

  private async deliver(
    context: PipelineContext,
    duration: number,
    reusedTranscript: boolean,
    youtube: string | null,
    whisperKey: string,
  ): Promise<Record<string, unknown>> {
    const { request, preset, workspace, tracker, signal } = context;
    const plan = await this.targets.define(workspace, targetsInput(request));
    const limits: Limits = {
      minSeconds: plan.minSeconds,
      maxSeconds: plan.maxSeconds,
      total: plan.sourceSeconds,
    };
    const averageClip = (plan.minSeconds + plan.maxSeconds) / 2;
    tracker.estimate(
      'render',
      await this.speed.estimate('render', plan.count * averageClip, RENDER_FACTOR),
    );
    const avoid = introSeconds(preset.id, duration);
    const waves = wavesFor(duration, avoid);
    const progressive = waves.length > 1;
    let transcribed = reusedTranscript;
    if (transcribed) {
      tracker.finish('transcribe', 'transcrição reaproveitada');
    } else if (youtube !== null) {
      transcribed = await this.gate(context, 'download', 'transcribe', 'na fila', async () => {
        tracker.start('transcribe', 'buscando a legenda do YouTube');
        const started = Date.now();
        const ok = await this.captions(youtube, workspace, context);
        if (ok) await this.speed.record('transcribe:captions', (Date.now() - started) / 1000, 1);
        return ok;
      });
      if (transcribed) {
        await this.markTranscribed(workspace);
        tracker.finish('transcribe', 'legenda do YouTube');
      }
    }
    assertActive(signal);

    const client = await this.clients.forSelector(request.selector);
    if (client === null)
      throw new AppError('INVALID_INPUT', 'escolha quem vai selecionar os cortes');
    const niche = this.niches.get(preset.niche);
    const guidance = await buildGuidance(preset.id, niche.guide);
    const peaks = await this.selector.peaks(workspace);
    const levels = ATTENTION_PRESETS.has(preset.id)
      ? this.media.rmsLevels(workspace.video('source')).catch(() => [])
      : Promise.resolve(null);
    const stage = request.selector.kind === 'ollama' ? 'select-local' : 'select-remote';
    const chunk = request.selector.kind === 'ollama' ? LOCAL_CHUNK : {};
    const chosen: Clip[] = [];
    const reserve: Candidate[] = [];
    const warnings = new Set<string>();
    const results: ClipResult[] = [];
    let whisperSeconds = 0;
    let selectSeconds = 0;
    let renderSeconds = 0;
    let rendered = 0;

    const publish = async (picked: readonly Candidate[], words: readonly Word[]): Promise<void> => {
      const fresh: Clip[] = [];
      for (const candidate of picked) {
        const clip = fitBetween(
          toClip(snap(candidate, words, limits), chosen.length + fresh.length, limits.total),
          [...chosen, ...fresh],
          limits.minSeconds,
        );
        if (clip !== null) fresh.push(clip);
      }
      if (fresh.length === 0) return;
      chosen.push(...fresh);
      await writeJson(workspace.cuts, cutsSchema.parse({ clips: chosen }));
      const done = chosen.length - fresh.length;
      const batch = await this.gate(context, 'render', 'render', 'na fila para renderizar', () =>
        withScaledProgress(done / plan.count, fresh.length / plan.count, async () => {
          tracker.update(
            'render',
            done / plan.count,
            `renderizando ${String(fresh.length)} corte(s)`,
          );
          const started = Date.now();
          const output = await this.renderer.run(
            workspace,
            context.outDir,
            request.accounts ?? [],
            'fast',
            fresh.map((clip) => clip.id),
          );
          renderSeconds += (Date.now() - started) / 1000;
          return output;
        }),
      );
      for (const result of batch) {
        results.push(result);
        if (!result.ok) {
          context.log('error', `o corte ${result.id} falhou: ${result.error ?? 'erro no render'}`);
          continue;
        }
        rendered += result.seconds;
        const clip = chosen.find((item) => item.id === result.id);
        await context.addClip({
          file: result.file,
          clipId: result.id,
          title: clip?.title ?? clip?.hook ?? result.id,
          hook: clip?.hook ?? null,
          score: clip?.score ?? null,
          account: result.account,
        });
      }
      const ready = new Set(results.filter((item) => item.ok).map((item) => item.id)).size;
      tracker.update(
        'render',
        Math.min(1, chosen.length / plan.count),
        `${String(ready)} de ${String(plan.count)} cortes prontos`,
      );
      tracker.update('organize', null, `${String(ready)} em Meus clipes`);
    };

    for (const [index, wave] of waves.entries()) {
      assertActive(signal);
      const last = index === waves.length - 1;
      if (!transcribed) {
        await this.gate(context, 'whisper', 'transcribe', 'na fila para transcrever', () =>
          withScaledProgress(
            wave.from / duration,
            (wave.to - wave.from) / duration,
            async () => {
              tracker.update(
                'transcribe',
                wave.from / duration,
                progressive
                  ? `transcrevendo ${formatSeconds(wave.from)} a ${formatSeconds(wave.to)}`
                  : 'transcrevendo',
              );
              const started = Date.now();
              await this.transcription.run(
                workspace,
                progressive ? { from: wave.from, to: wave.to } : {},
              );
              whisperSeconds += (Date.now() - started) / 1000;
            },
            (fraction) => `transcrevendo ${String(Math.round(fraction * 100))}% do vídeo`,
          ),
        );
        if (last) {
          await this.markTranscribed(workspace);
          tracker.finish('transcribe');
        }
      }
      const remaining = plan.count - chosen.length;
      if (remaining <= 0) continue;
      const words = await this.selector.words(workspace);
      const span = Math.max(1, duration - wave.from);
      const want = last
        ? remaining
        : Math.min(remaining, Math.max(1, Math.round((remaining * (wave.to - wave.from)) / span)));
      const pool = await this.gate(context, stage, 'select', 'na fila para escolher', () =>
        withScaledProgress(index / waves.length, 1 / waves.length, async () => {
          tracker.update(
            'select',
            index / waves.length,
            progressive
              ? `procurando cortes em ${formatSeconds(wave.from)} a ${formatSeconds(wave.to)}`
              : 'lendo a transcrição',
          );
          const started = Date.now();
          const found = await this.selector.pool(words, {
            client,
            niche: `${niche.label}: ${niche.summary}`,
            guidance,
            limits,
            count: want,
            from: index === 0 ? 0 : Math.max(0, wave.from - limits.maxSeconds),
            to: last ? limits.total : wave.to,
            avoidStartSeconds: avoid,
            chunk,
            peaks,
            fallback: true,
            judge: true,
            levels: await levels,
            taken: chosen,
          });
          selectSeconds += (Date.now() - started) / 1000;
          return found;
        }),
      );
      for (const warning of pool.warnings) warnings.add(warning);
      const ranked = [...pool.candidates].sort((a, b) => b.score - a.score);
      const picked: Candidate[] = [];
      for (const candidate of ranked) {
        const overlaps = [...chosen, ...picked].some(
          (other) => candidate.start < other.end && other.start < candidate.end,
        );
        const room = chosen.length + picked.length < plan.count;
        const early =
          picked.length < want ||
          (candidate.score >= EARLY_SCORE && picked.length < want + EARLY_EXTRA);
        if (!overlaps && room && early && candidate.score >= MIN_SCORE) picked.push(candidate);
        else if (!overlaps) reserve.push(candidate);
      }
      if (picked.length > 0) await publish(picked, words);
      if (index < waves.length - 1) {
        tracker.update(
          'select',
          (index + 1) / waves.length,
          `${String(chosen.length)} de ${String(plan.count)} cortes escolhidos`,
        );
      }
    }
    if (!transcribed) {
      await this.speed.record(whisperKey, whisperSeconds, duration);
    }

    if (chosen.length < plan.count && reserve.length > 0) {
      const words = await this.selector.words(workspace);
      const free = reserve.filter(
        (candidate) =>
          !chosen.some((other) => candidate.start < other.end && other.start < candidate.end),
      );
      let extra = pickBest(free, plan.count - chosen.length, MIN_SCORE);
      if (extra.length === 0 && chosen.length === 0) {
        extra = pickBest(free, plan.count, 0);
        if (extra.length > 0) {
          warnings.add(
            `nenhum trecho chegou à nota ${String(MIN_SCORE)}; usei os de maior nota que o modelo achou`,
          );
        }
      }
      if (extra.length > 0) await publish(extra, words);
    }
    const selectKey = selectSpeedKey(request);
    if (selectKey !== null) {
      await this.speed.record(
        selectKey,
        selectSeconds,
        Math.max(1, Math.ceil(duration / CHUNK_SECONDS)),
      );
    }
    if (rendered > 0) await this.speed.record('render', renderSeconds, rendered);
    for (const warning of warnings) context.log('warn', warning);
    if (chosen.length === 0) {
      const spoken = (await this.selector.words(workspace)).length;
      throw new AppError(
        'INVALID_INPUT',
        spoken < MIN_SPOKEN_WORDS
          ? 'não encontrei fala nesse vídeo: o áudio está mudo ou não tem voz'
          : 'o modelo não achou nenhum corte bom nesse vídeo (tente outro modelo)',
      );
    }
    if (chosen.length < plan.count) {
      context.log(
        'warn',
        `o plano pedia ${String(plan.count)} cortes e só ${String(chosen.length)} ficaram bons o bastante`,
      );
    }
    const failed = results.filter((result) => !result.ok);
    if (results.length > 0 && failed.length === results.length) {
      throw new AppError('PROCESS_FAILED', 'nenhum corte conseguiu ser renderizado');
    }
    tracker.finish('select', `${String(chosen.length)} cortes escolhidos`);
    tracker.finish('render');
    tracker.finish('organize', 'tudo em Meus clipes');
    return {
      clips: results.filter((item) => item.ok).length,
      failed: failed.length,
      seconds: Math.round(duration),
    };
  }

  private async runWithAgent(
    context: PipelineContext,
    duration: number,
    reusedTranscript: boolean,
    youtube: string | null,
    whisperKey: string,
  ): Promise<Record<string, unknown>> {
    const { request, workspace, tracker, signal } = context;
    if (reusedTranscript) {
      tracker.finish('transcribe', 'transcrição reaproveitada');
    } else {
      tracker.start('transcribe', 'preparando a transcrição');
      const started = Date.now();
      const method = await this.transcribe(youtube, workspace, context);
      const spent = (Date.now() - started) / 1000;
      if (method === 'captions') await this.speed.record('transcribe:captions', spent, 1);
      else await this.speed.record(whisperKey, spent, duration);
      await this.markTranscribed(workspace);
      tracker.finish('transcribe');
    }
    assertActive(signal);

    const plan = await this.targets.define(workspace, targetsInput(request));
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
    const renderStarted = Date.now();
    const results = await this.renderer.run(
      workspace,
      context.outDir,
      request.accounts ?? [],
      'fast',
    );
    const rendered = results.filter((item) => item.ok).reduce((sum, item) => sum + item.seconds, 0);
    await this.speed.record('render', (Date.now() - renderStarted) / 1000, rendered);
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
      seconds: Math.round(duration),
    };
  }

  private gate<T>(
    context: PipelineContext,
    stage: Stage,
    step: JobStepId,
    message: string,
    task: () => Promise<T>,
  ): Promise<T> {
    return this.gates.run(
      stage,
      context.signal,
      () => {
        context.tracker.update(step, null, message);
      },
      task,
    );
  }

  async frameAt(workspace: Workspace, at: number): Promise<{ frame: string; at: number }> {
    const meta = await this.media.probe(workspace.video('source'));
    const moment = Number(Math.min(Math.max(0, meta.duration - 0.5), Math.max(0, at)).toFixed(1));
    const name = `frame-at-${String(Math.round(moment * 10))}.jpg`;
    const file = workspace.file(name);
    if (!(await exists(file))) {
      await this.media.frame(workspace.video('source'), moment, file, CAMERA_FRAME_WIDTH);
    }
    return { frame: name, at: moment };
  }

  private async cameraFrames(
    workspace: Workspace,
    duration: number,
  ): Promise<{ frame: string; at: number; strip: { name: string; at: number }[] }> {
    const strip: { name: string; at: number; size: number }[] = [];
    for (let index = 0; index < STRIP_FRAMES; index += 1) {
      const at = Number(((duration * (index + 1)) / (STRIP_FRAMES + 1)).toFixed(2));
      const name = `frame-strip-${String(index)}.jpg`;
      const file = workspace.file(name);
      const ok = await this.media
        .frame(workspace.video('source'), at, file, STRIP_WIDTH)
        .then(() => true)
        .catch(() => false);
      if (!ok) continue;
      const size = (await fs.stat(file).catch(() => null))?.size ?? 0;
      strip.push({ name, at, size });
    }
    const richest = [...strip].sort((a, b) => b.size - a.size)[0];
    const at = richest?.at ?? Math.min(30, duration / 3);
    const frame = workspace.file('frame-camera.jpg');
    await this.media.frame(workspace.video('source'), at, frame, CAMERA_FRAME_WIDTH);
    return {
      frame: path.basename(frame),
      at,
      strip: strip.map((item) => ({ name: item.name, at: item.at })),
    };
  }

  private async markTranscribed(workspace: Workspace): Promise<void> {
    await writeJson(workspace.file('transcribed.json'), { complete: true });
  }

  private async captions(
    youtube: string,
    workspace: Workspace,
    context: PipelineContext,
  ): Promise<boolean> {
    const settings = await this.config.load();
    const language = settings.language === 'auto' ? 'pt' : settings.language;
    try {
      await this.transcription.fromYoutube(workspace, language, youtube);
      return true;
    } catch (error) {
      context.log(
        'warn',
        `sem legenda do YouTube (${describe(error)}); transcrevendo com o whisper`,
      );
      return false;
    }
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
      transcript:
        carried.has('captions.json') &&
        carried.has('silences.json') &&
        carried.has('transcribed.json'),
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

  private bottomOf(request: JobRequest, preset: Preset): BottomPlan {
    return bottomPlan(preset, request.bottom, this.niches.get(preset.niche).defaultBottomUrl);
  }

  private async prepareBottom(plan: BottomPlan, workspace: Workspace): Promise<void> {
    if (plan.kind === 'source') return;
    if (plan.kind === 'file') {
      await this.fetcher.fetch(await this.uploadPath(plan.uploadId), 'bottom', workspace);
      return;
    }
    const url = plan.url;
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
  ): Promise<'captions' | 'whisper'> {
    const settings = await this.config.load();
    if (youtube !== null) {
      const language = settings.language === 'auto' ? 'pt' : settings.language;
      try {
        await this.transcription.fromYoutube(workspace, language, youtube);
        return 'captions';
      } catch (error) {
        context.log(
          'warn',
          `sem legenda do YouTube (${describe(error)}); transcrevendo com o whisper`,
        );
      }
    }
    await this.transcription.run(workspace, {});
    return 'whisper';
  }

  private async select(
    context: PipelineContext,
    plan: { count: number; minSeconds: number; maxSeconds: number; sourceSeconds: number },
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
      guidance: await buildGuidance(preset.id, niche.guide),
      avoidStartSeconds: introSeconds(preset.id, plan.sourceSeconds),
      judge: true,
      attention: ATTENTION_PRESETS.has(preset.id),
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

export function wavesFor(duration: number, intro: number): { from: number; to: number }[] {
  if (duration <= PROGRESSIVE_FROM) return [{ from: 0, to: duration }];
  const waves: { from: number; to: number }[] = [];
  let from = 0;
  let size = Math.min(duration, intro + FIRST_WAVE_SECONDS);
  while (from < duration) {
    const to = duration - (from + size) < WAVE_SECONDS / 2 ? duration : from + size;
    waves.push({ from, to });
    from = to;
    size = WAVE_SECONDS;
  }
  return waves;
}

export function fitBetween(clip: Clip, taken: readonly Clip[], minSeconds: number): Clip | null {
  let { start, end } = clip;
  for (const other of taken) {
    if (start >= other.end || other.start >= end) continue;
    if (other.start <= start) start = other.end;
    else end = other.start;
  }
  if (end - start < minSeconds * MIN_KEPT_SHARE) return null;
  return { ...clip, start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) };
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

export function selectSpeedKey(request: JobRequest): string | null {
  const selector = request.selector;
  if (selector.kind === 'ollama') return `select:ollama-${selector.model}`;
  if (selector.kind === 'api') return `select:api-${selector.keyId}`;
  return null;
}
