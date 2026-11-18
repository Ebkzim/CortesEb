import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { Progress } from '../common/progress.js';
import { cutsSchema, type Clip } from '../contracts/cuts.js';
import { captionsSchema } from '../contracts/media.js';
import { LlmService, type LlmSettings } from '../llm/llm.service.js';
import { extractJson, type LlmClient } from '../llm/llm-client.js';
import { peaksFileSchema } from '../analysis/peaks.service.js';
import { TargetsService, type TargetsInput } from '../planning/targets.service.js';
import { dropMarkers } from '../transcription/tokens.js';
import type { Workspace } from '../workspace/workspace.js';
import { ClipJudge } from '../live/clip-judge.js';
import type { Word } from '../contracts/media.js';
import { MediaTools } from '../media/media-tools.js';
import { attentionMoments } from './attention.js';
import { filterCandidates, speechWindows, textOf } from './filters.js';
import { pickBest, separate, snap, toClip, usable, type Limits } from './candidates.js';
import {
  answerJsonSchema,
  answerSchema,
  buildSystemPrompt,
  buildUserPrompt,
  type Candidate,
  type PromptContext,
} from './prompt.js';
import { chunkTranscript, type ChunkOptions, type TranscriptChunk } from './transcript-chunks.js';

export interface SelectRequest {
  llm: Partial<LlmSettings>;
  client?: LlmClient;
  targets: TargetsInput;
  niche: string;
  minScore: number;
  chunk: Partial<ChunkOptions>;
  fallback?: boolean;
  guidance?: string;
  avoidStartSeconds?: number;
  judge?: boolean;
  attention?: boolean;
}

export interface SelectResult {
  model: string;
  chunks: number;
  candidates: number;
  seconds: number;
  warnings: string[];
  clips: { id: string; start: number; end: number; score: number; hook: string }[];
}

export interface Span {
  start: number;
  end: number;
}

export interface PoolRequest {
  client: LlmClient;
  niche: string;
  guidance?: string;
  limits: Limits;
  count: number;
  from: number;
  to: number;
  avoidStartSeconds: number;
  chunk: Partial<ChunkOptions>;
  peaks: readonly number[];
  fallback: boolean;
  judge: boolean;
  levels: readonly number[] | null;
  taken: readonly Span[];
}

export interface Pool {
  candidates: Candidate[];
  warnings: string[];
  chunks: number;
  proposed: number;
}

const MAX_TOKENS = 1200;
const MIN_PER_CHUNK = 2;
const MAX_PER_CHUNK = 5;
const JUDGE_POOL_FACTOR = 3;
const JUDGE_POOL_MAX = 12;
const MODEL_WEIGHT = 1;
const JUDGE_WEIGHT = 2;
const MOMENT_JUDGE_WEIGHT = 1;
const HOOK_CHARS = 300;
const SHORT_HOOK_WORDS = 5;

@Injectable()
export class SelectorService {
  constructor(
    private readonly llm: LlmService,
    private readonly targets: TargetsService,
    private readonly progress: Progress,
    private readonly media: MediaTools,
  ) {}

  async run(workspace: Workspace, request: SelectRequest): Promise<SelectResult> {
    const started = Date.now();
    const client = request.client ?? (await this.llm.client(request.llm));
    const words = await this.words(workspace);
    const plan = await this.targets.define(workspace, request.targets);
    const limits: Limits = {
      minSeconds: plan.minSeconds,
      maxSeconds: plan.maxSeconds,
      total: plan.sourceSeconds,
    };
    const avoid = request.avoidStartSeconds ?? 0;
    const pool = await this.pool(words, {
      client,
      niche: request.niche,
      ...(request.guidance === undefined ? {} : { guidance: request.guidance }),
      limits,
      count: plan.count,
      from: 0,
      to: plan.sourceSeconds,
      avoidStartSeconds: avoid,
      chunk: request.chunk,
      peaks: await this.peaks(workspace),
      fallback: request.fallback === true,
      judge: request.judge === true,
      levels: request.attention === true ? await this.levels(workspace) : null,
      taken: [],
    });
    const warnings = [...pool.warnings];
    let best = pickBest(pool.candidates, plan.count, request.minScore);
    if (best.length === 0 && request.fallback === true && pool.candidates.length > 0) {
      best = pickBest(pool.candidates, plan.count, 0);
      warnings.push(
        `nenhum trecho chegou à nota ${String(request.minScore)}; usei os de maior nota que o modelo achou`,
      );
    }
    if (best.length === 0 && pool.candidates.length === 0) {
      throw new AppError(
        'REMOTE_FAILED',
        'o modelo não devolveu nenhum trecho válido (tente outro modelo ou uma transcrição melhor)',
      );
    }
    if (best.length === 0) {
      throw new AppError(
        'INVALID_INPUT',
        'o modelo não achou cortes com nota suficiente (tente outro modelo ou --min-score menor)',
      );
    }
    const clips: Clip[] = separate(
      best.map((candidate, index) =>
        toClip(snap(candidate, words, limits), index, plan.sourceSeconds),
      ),
    );
    const cuts = cutsSchema.parse({ clips });
    await writeJson(workspace.cuts, cuts);
    if (best.length < plan.count) {
      warnings.push(
        `o plano pedia ${plan.count} cortes e só ${best.length} passaram da nota mínima`,
      );
    }
    return {
      model: client.label,
      chunks: pool.chunks,
      candidates: pool.proposed,
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      warnings,
      clips: cuts.clips.map((clip) => ({
        id: clip.id,
        start: clip.start,
        end: clip.end,
        score: clip.score ?? 0,
        hook: clip.hook ?? '',
      })),
    };
  }

  async words(workspace: Workspace): Promise<Word[]> {
    return dropMarkers(await readJson(workspace.captions, captionsSchema));
  }

  async levels(workspace: Workspace): Promise<number[]> {
    this.progress.step('select', null, 'procurando momentos de atenção no áudio');
    return this.media.rmsLevels(workspace.video('source')).catch(() => []);
  }

  async peaks(workspace: Workspace): Promise<number[]> {
    const file = workspace.file('peaks.json');
    if (!(await exists(file))) return [];
    const data = await readJson(file, peaksFileSchema).catch(() => ({ windows: [] }));
    return data.windows.map((window) => Math.round(window.peakAt));
  }

  async pool(allWords: readonly Word[], request: PoolRequest): Promise<Pool> {
    const { client, limits } = request;
    const floor = Math.max(request.from, request.avoidStartSeconds);
    const words = allWords.filter(
      (word) => word.startMs / 1000 >= floor && word.startMs / 1000 < request.to,
    );
    const free = (candidate: Candidate): boolean =>
      candidate.end <= request.to + 1 &&
      !request.taken.some((span) => candidate.start < span.end && span.start < candidate.end);
    const chunks = chunkTranscript(words, request.chunk);
    const warnings: string[] = [];
    if (chunks.length === 0) return { candidates: [], warnings, chunks: 0, proposed: 0 };
    const context = {
      niche: request.niche,
      perChunk: Math.max(MIN_PER_CHUNK, Math.min(MAX_PER_CHUNK, request.count + 1)),
      targets: limits,
      ...(request.guidance === undefined ? {} : { guidance: request.guidance }),
    };
    const found: Candidate[] = [];
    for (const [index, chunk] of chunks.entries()) {
      this.progress.step(
        'select',
        ((request.judge ? 0.6 : 1) * index) / chunks.length,
        `lendo o trecho ${String(index + 1)} de ${String(chunks.length)} com ${client.label}`,
      );
      const answer = await this.ask(client, chunk, {
        ...context,
        peaks: request.peaks.filter((second) => second >= chunk.from && second < chunk.to),
      }).catch((error: unknown) => {
        warnings.push(`trecho ${String(index + 1)}: ${describe(error)}`);
        return [];
      });
      for (const candidate of answer) {
        const fitted = usable(candidate, limits);
        if (fitted !== null && free(fitted)) found.push(fitted);
      }
    }
    const filtered = filterCandidates(found, allWords, request.avoidStartSeconds);
    if (filtered.dropped.length > 0) {
      warnings.push(
        `${String(filtered.dropped.length)} trecho(s) descartado(s): ${[...new Set(filtered.dropped.map((item) => item.reason))].join(', ')}`,
      );
    }
    let candidates = filtered.kept;
    if (candidates.length < request.count && request.fallback) {
      const extra = speechWindows(words, {
        from: floor,
        total: Math.min(limits.total, request.to),
        length: (limits.minSeconds + limits.maxSeconds) / 2,
        limit: Math.min(JUDGE_POOL_MAX, request.count * JUDGE_POOL_FACTOR),
      }).filter(
        (window) =>
          free(window) &&
          !candidates.some((item) => window.start < item.end && item.start < window.end),
      );
      const usableExtra = filterCandidates(extra, allWords, request.avoidStartSeconds).kept;
      if (usableExtra.length > 0) {
        warnings.push(
          `o modelo sugeriu poucos trechos; somei ${String(usableExtra.length)} trecho(s) com mais fala para avaliação`,
        );
        candidates = [...candidates, ...usableExtra];
      }
    }
    const moments = (
      request.levels === null
        ? []
        : attentionMoments(allWords, request.levels, {
            from: floor,
            minSeconds: limits.minSeconds,
            maxSeconds: limits.maxSeconds,
          })
    )
      .filter((moment) => moment.start < request.to && free(moment))
      .filter(
        (moment) =>
          !candidates.some(
            (item) =>
              moment.start < item.end && item.start < moment.end && item.score >= moment.score,
          ),
      );
    if (moments.length > 0) {
      warnings.push(
        `${String(moments.length)} momento(s) de atenção (conteúdo forte sem fala, seguido de reação)`,
      );
    }
    const judged = request.judge
      ? [
          ...(await this.rejudge(client, candidates, allWords, request, JUDGE_WEIGHT, false)),
          ...(await this.rejudge(client, moments, allWords, request, MOMENT_JUDGE_WEIGHT, true)),
        ]
      : [...candidates, ...moments];
    return {
      candidates: judged,
      warnings,
      chunks: chunks.length,
      proposed: found.length,
    };
  }

  private async ask(
    client: LlmClient,
    chunk: TranscriptChunk,
    context: PromptContext,
  ): Promise<Candidate[]> {
    const base = {
      system: buildSystemPrompt(context),
      schema: answerJsonSchema(context.perChunk),
      maxTokens: MAX_TOKENS,
    };
    const user = buildUserPrompt(chunk, context);
    try {
      return parseAnswer(await client.complete({ ...base, user }), chunk);
    } catch {
      const retry = `${user}\n\nYour previous answer was not valid. Answer again with only the JSON object.`;
      return parseAnswer(await client.complete({ ...base, user: retry }), chunk);
    }
  }

  private async rejudge(
    client: LlmClient,
    candidates: readonly Candidate[],
    words: readonly Word[],
    request: PoolRequest,
    weight: number,
    retitle: boolean,
  ): Promise<Candidate[]> {
    if (candidates.length === 0) return [];
    const count = request.count;
    const pool = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(JUDGE_POOL_MAX, Math.max(count, count * JUDGE_POOL_FACTOR)));
    const judge = new ClipJudge(client, 0, `${request.niche}\n${request.guidance ?? ''}`);
    const judged: Candidate[] = [];
    for (const [index, candidate] of pool.entries()) {
      this.progress.step(
        'select',
        0.6 + (0.4 * index) / Math.max(1, pool.length),
        `avaliando o trecho ${String(index + 1)} de ${String(pool.length)}`,
      );
      const verdict = await judge
        .judge(textOf(words, candidate.start, candidate.end))
        .catch(() => null);
      judged.push(
        verdict === null
          ? candidate
          : {
              ...candidate,
              title: retitle ? verdict.title : candidate.title,
              score:
                (candidate.score * MODEL_WEIGHT + verdict.score * weight) / (MODEL_WEIGHT + weight),
            },
      );
    }
    return judged;
  }
}

export function parseAnswer(text: string, chunk: TranscriptChunk): Candidate[] {
  const parsed = answerSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new AppError('REMOTE_FAILED', 'resposta do modelo fora do formato');
  const byId = new Map(chunk.lines.map((line) => [line.id, line]));
  return parsed.data.clips.flatMap((pick) => {
    const first = byId.get(pick.first_line);
    const last = byId.get(pick.last_line);
    if (first === undefined || last === undefined || last.id < first.id) return [];
    const opening =
      first.text.split(' ').length < SHORT_HOOK_WORDS
        ? `${first.text} ${byId.get(first.id + 1)?.text ?? ''}`.trim()
        : first.text;
    return [
      {
        start: first.start,
        end: last.end,
        score: pick.score,
        hook: opening.slice(0, HOOK_CHARS),
        title: pick.title,
        ...(pick.topic === undefined || pick.topic === '' ? {} : { topic: pick.topic }),
      },
    ];
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? 'erro') : 'erro';
}
