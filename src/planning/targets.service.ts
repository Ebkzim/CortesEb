import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { cutsSchema } from '../contracts/cuts.js';
import { captionsSchema, silencesSchema } from '../contracts/media.js';
import { RENDER_FPS } from '../contracts/render.js';
import { MediaTools } from '../media/media-tools.js';
import { planClip } from '../timeline/plan.js';
import type { Workspace } from '../workspace/workspace.js';
import { deriveTargets, targetsSchema, type ClipTargets } from './clip-targets.js';

export interface ClipCheck {
  id: string;
  seconds: number;
  ok: boolean;
  problem?: string;
}

export interface CutsCheck {
  ok: boolean;
  targets: ClipTargets | null;
  count: number;
  problems: string[];
  clips: ClipCheck[];
}

export interface TargetsInput {
  minSeconds?: number;
  maxSeconds?: number;
  count?: number;
}

const TOLERANCE_SECONDS = 0.5;
const TARGETS_FILE = 'targets.json';

@Injectable()
export class TargetsService {
  constructor(private readonly media: MediaTools) {}

  async define(workspace: Workspace, input: TargetsInput): Promise<ClipTargets> {
    const source = workspace.video('source');
    if (!(await exists(source))) {
      throw new AppError('MISSING_FILE', 'falta o source.mp4 na pasta de trabalho');
    }
    const targets = deriveTargets({ sourceSeconds: await this.media.duration(source), ...input });
    await writeJson(workspace.file(TARGETS_FILE), targets);
    return targets;
  }

  async load(workspace: Workspace): Promise<ClipTargets | null> {
    const file = workspace.file(TARGETS_FILE);
    return (await exists(file)) ? readJson(file, targetsSchema) : null;
  }

  async check(workspace: Workspace): Promise<CutsCheck> {
    const cuts = await readJson(workspace.cuts, cutsSchema);
    const words = await readJson(workspace.captions, captionsSchema);
    const silences = await readJson(workspace.silences, silencesSchema);
    const sourceDuration = await this.media.duration(workspace.video('source'));
    const targets = await this.load(workspace);
    const clips = cuts.clips.map((clip): ClipCheck => {
      const plan = planClip({ clip, words, silences, sourceDuration, fps: RENDER_FPS });
      const seconds = Number(plan.totalSeconds.toFixed(1));
      const problem = targets === null ? undefined : durationProblem(seconds, targets);
      return { id: clip.id, seconds, ok: problem === undefined, ...(problem ? { problem } : {}) };
    });
    const problems = [...overlaps(cuts.clips)];
    if (targets !== null && clips.length !== targets.count) {
      problems.push(`o plano pede ${targets.count} cortes e o cuts.json tem ${clips.length}`);
    }
    return {
      ok: problems.length === 0 && clips.every((clip) => clip.ok),
      targets,
      count: clips.length,
      problems,
      clips,
    };
  }

  async assert(workspace: Workspace): Promise<void> {
    const check = await this.check(workspace);
    if (check.ok) return;
    const first = check.problems[0] ?? check.clips.find((clip) => !clip.ok)?.problem;
    throw new AppError('INVALID_INPUT', `cortes fora do plano: ${first ?? 'veja cortes-eb check'}`);
  }
}

function durationProblem(seconds: number, targets: ClipTargets): string | undefined {
  if (seconds < targets.minSeconds - TOLERANCE_SECONDS) {
    return `${seconds} s é menos que o mínimo de ${targets.minSeconds} s`;
  }
  if (seconds > targets.maxSeconds + TOLERANCE_SECONDS) {
    return `${seconds} s é mais que o máximo de ${targets.maxSeconds} s`;
  }
  return undefined;
}

function overlaps(clips: readonly { id: string; start: number; end: number }[]): string[] {
  const ordered = [...clips].sort((a, b) => a.start - b.start);
  const found: string[] = [];
  ordered.forEach((clip, index) => {
    const next = ordered[index + 1];
    if (next !== undefined && next.start < clip.end) {
      found.push(`${clip.id} e ${next.id} se sobrepõem no vídeo de origem`);
    }
  });
  return found;
}
