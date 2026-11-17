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

const MAX_TOKENS = 900;
const MIN_PER_CHUNK = 2;
const MAX_PER_CHUNK = 5;
const JUDGE_POOL_FACTOR = 3;
const JUDGE_POOL_MAX = 12;
const MODEL_WEIGHT = 1;
const JUDGE_WEIGHT = 2;

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
    const words = dropMarkers(await readJson(workspace.captions, captionsSchema));
    const plan = await this.targets.define(workspace, request.targets);
    const limits: Limits = {
      minSeconds: plan.minSeconds,
      maxSeconds: plan.maxSeconds,
      total: plan.sourceSeconds,
    };
    const avoid = request.avoidStartSeconds ?? 0;
    const chunks = chunkTranscript(
      words.filter((word) => word.startMs / 1000 >= avoid),
      request.chunk,
    );
    if (chunks.length === 0) throw new AppError('INVALID_INPUT', 'a transcrição está vazia');
    const peaks = await this.peaks(workspace);
    const context = {
      niche: request.niche,
      perChunk: Math.max(MIN_PER_CHUNK, Math.min(MAX_PER_CHUNK, plan.count + 1)),
      targets: plan,
      ...(request.guidance === undefined ? {} : { guidance: request.guidance }),
    };
    const warnings: string[] = [];
    const found: Candidate[] = [];
    for (const [index, chunk] of chunks.entries()) {
      this.progress.step(
        'select',
        ((request.judge === true ? 0.6 : 1) * index) / chunks.length,
        `lendo o trecho ${index + 1} de ${chunks.length} com ${client.label}`,
      );
      const answer = await this.ask(client, chunk, {
        ...context,
        peaks: peaks.filter((second) => second >= chunk.from && second < chunk.to),
      }).catch((error: unknown) => {
        warnings.push(`trecho ${index + 1}: ${describe(error)}`);
        return [];
      });
      for (const candidate of answer) {
        const fitted = usable(candidate, limits);
        if (fitted !== null) found.push(fitted);
      }
    }
    const filtered = filterCandidates(found, words, request.avoidStartSeconds ?? 0);
    if (filtered.dropped.length > 0) {
      warnings.push(
        `${String(filtered.dropped.length)} trecho(s) descartado(s): ${[...new Set(filtered.dropped.map((item) => item.reason))].join(', ')}`,
      );
    }
    let candidates = filtered.kept;
    if (candidates.length < plan.count && request.fallback === true) {
      const extra = speechWindows(words, {
        from: avoid,
        total: plan.sourceSeconds,
        length: (plan.minSeconds + plan.maxSeconds) / 2,
        limit: Math.min(JUDGE_POOL_MAX, plan.count * JUDGE_POOL_FACTOR),
      }).filter(
        (window) => !candidates.some((item) => window.start < item.end && item.start < window.end),
      );
      const usableExtra = filterCandidates(extra, words, avoid).kept;
      if (usableExtra.length > 0) {
        warnings.push(
          `o modelo sugeriu poucos trechos; somei ${String(usableExtra.length)} trecho(s) com mais fala para avaliação`,
        );
        candidates = [...candidates, ...usableExtra];
      }
    }
    const judged =
      request.judge === true
        ? await this.rejudge(client, candidates, words, request, plan.count)
        : candidates;
    const moments =
      request.attention === true ? await this.attention(workspace, words, avoid, plan) : [];
    if (moments.length > 0) {
      warnings.push(
        `${String(moments.length)} momento(s) de atenção (conteúdo forte sem fala, seguido de reação)`,
      );
    }
    const pool = [
      ...judged,
      ...moments.filter(
        (moment) =>
          !judged.some(
            (item) =>
              moment.start < item.end && item.start < moment.end && item.score >= moment.score,
          ),
      ),
    ];
    let best = pickBest(pool, plan.count, request.minScore);
    if (best.length === 0 && request.fallback === true && pool.length > 0) {
      best = pickBest(pool, plan.count, 0);
      warnings.push(
        `nenhum trecho chegou à nota ${String(request.minScore)}; usei os de maior nota que o modelo achou`,
      );
    }
    if (best.length === 0 && pool.length === 0) {
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
      chunks: chunks.length,
      candidates: found.length,
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
    request: SelectRequest,
    count: number,
  ): Promise<Candidate[]> {
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
              score:
                (candidate.score * MODEL_WEIGHT + verdict.score * JUDGE_WEIGHT) /
                (MODEL_WEIGHT + JUDGE_WEIGHT),
            },
      );
    }
    return judged;
  }

  private async attention(
    workspace: Workspace,
    words: readonly Word[],
    from: number,
    plan: { minSeconds: number; maxSeconds: number },
  ): Promise<Candidate[]> {
    this.progress.step('select', null, 'procurando momentos de atenção no áudio');
    const levels = await this.media.rmsLevels(workspace.video('source')).catch(() => []);
    return attentionMoments(words, levels, {
      from,
      minSeconds: plan.minSeconds,
      maxSeconds: plan.maxSeconds,
    });
  }

  private async peaks(workspace: Workspace): Promise<number[]> {
    const file = workspace.file('peaks.json');
    if (!(await exists(file))) return [];
    const data = await readJson(file, peaksFileSchema).catch(() => ({ windows: [] }));
    return data.windows.map((window) => Math.round(window.peakAt));
  }
}

export function parseAnswer(text: string, chunk: TranscriptChunk): Candidate[] {
  const parsed = answerSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new AppError('REMOTE_FAILED', 'resposta do modelo fora do formato');
  return parsed.data.clips.filter(
    (candidate) =>
      candidate.end > candidate.start &&
      candidate.start >= chunk.from - 1 &&
      candidate.end <= chunk.to + 1,
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? 'erro') : 'erro';
}
