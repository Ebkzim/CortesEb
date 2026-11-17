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

@Injectable()
export class SelectorService {
  constructor(
    private readonly llm: LlmService,
    private readonly targets: TargetsService,
    private readonly progress: Progress,
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
    const chunks = chunkTranscript(words, request.chunk);
    if (chunks.length === 0) throw new AppError('INVALID_INPUT', 'a transcrição está vazia');
    const peaks = await this.peaks(workspace);
    const context = {
      niche: request.niche,
      perChunk: Math.max(MIN_PER_CHUNK, Math.min(MAX_PER_CHUNK, plan.count)),
      targets: plan,
    };
    const warnings: string[] = [];
    const found: Candidate[] = [];
    for (const [index, chunk] of chunks.entries()) {
      this.progress.step(
        'select',
        index / chunks.length,
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
    let best = pickBest(found, plan.count, request.minScore);
    if (best.length === 0 && request.fallback === true && found.length > 0) {
      best = pickBest(found, plan.count, 0);
      warnings.push(
        `nenhum trecho chegou à nota ${String(request.minScore)}; usei os de maior nota que o modelo achou`,
      );
    }
    if (best.length === 0 && found.length === 0) {
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
