import type { Layout } from '../contracts/layout.js';
import type { JobBottom, JobRequest, PercentRect, PresetId } from '../contracts/job.js';

export type SourceType = JobRequest['source']['type'];

const ALL_SOURCES: readonly SourceType[] = ['file', 'youtube', 'vod', 'live'];
const RECORDED: readonly SourceType[] = ['file', 'youtube', 'vod'];

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  niche: string;
  camera: 'ask' | 'none' | 'fixed';
  bottom: 'source' | 'niche';
  sources: readonly SourceType[];
  top: string;
  below: string;
  layout: Layout;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'gameplay-camera',
    sources: ALL_SOURCES,
    label: 'Gameplay com câmera',
    description: 'O rosto de quem joga em cima e o jogo embaixo.',
    niche: 'gameplay',
    camera: 'ask',
    bottom: 'source',
    top: 'câmera',
    below: 'gameplay',
    layout: { bottom: 'source' },
  },
  {
    id: 'gta6-gameplay',
    sources: ALL_SOURCES,
    label: 'Gameplay GTA 6',
    description: 'O gameplay em cima e o trailer de GTA 6 embaixo.',
    niche: 'gta6',
    camera: 'none',
    bottom: 'niche',
    top: 'gameplay',
    below: 'trailer GTA 6',
    layout: { camera: 'none', bottom: 'video' },
  },
  {
    id: 'gta6-react',
    sources: ALL_SOURCES,
    label: 'React GTA 6',
    description: 'O rosto de quem reage em cima e o GTA 6 embaixo.',
    niche: 'gta6',
    camera: 'ask',
    bottom: 'source',
    top: 'câmera',
    below: 'GTA 6',
    layout: { bottom: 'source' },
  },
  {
    id: 'filmes',
    sources: RECORDED,
    label: 'Filmes',
    description: 'Quem comenta em cima e a cena do filme embaixo.',
    niche: 'filmes-series',
    camera: 'ask',
    bottom: 'source',
    top: 'câmera',
    below: 'cena do filme',
    layout: { bottom: 'source' },
  },
  {
    id: 'series',
    sources: RECORDED,
    label: 'Séries',
    description: 'Quem comenta em cima e a cena da série embaixo.',
    niche: 'filmes-series',
    camera: 'ask',
    bottom: 'source',
    top: 'câmera',
    below: 'cena da série',
    layout: { bottom: 'source' },
  },
  {
    id: 'podcast',
    sources: ALL_SOURCES,
    label: 'Podcast',
    description: 'Um lado da conversa em cima e o outro embaixo.',
    niche: 'podcast',
    camera: 'fixed',
    bottom: 'source',
    top: 'lado esquerdo',
    below: 'lado direito',
    layout: { camera: '0,0,63.3,100', bottom: 'source', bottomArea: '36.7,0,63.3,100' },
  },
];

export function presetOf(id: PresetId): Preset {
  const preset = PRESETS.find((item) => item.id === id);
  if (preset === undefined) throw new Error(`preset desconhecido: ${id}`);
  return preset;
}

export function layoutFor(preset: Preset, camera: PercentRect | undefined): Layout {
  if (preset.camera !== 'ask' || camera === undefined) return { ...preset.layout };
  return { ...preset.layout, camera: rectSpec(camera) };
}

export function rectSpec(rect: PercentRect): string {
  return [rect.x, rect.y, rect.w, rect.h].map((value) => Number(value.toFixed(2))).join(',');
}

export const DEFAULT_CAMERA: PercentRect = { x: 0.7, y: 2.8, w: 17.5, h: 27.6 };

export type BottomPlan =
  { kind: 'source' } | { kind: 'url'; url: string } | { kind: 'file'; uploadId: string };

export function bottomPlan(
  preset: Preset,
  bottom: JobBottom | undefined,
  nicheUrl: string | null,
): BottomPlan {
  const choice = bottom ?? { type: 'default' };
  if (choice.type === 'source') return { kind: 'source' };
  if (choice.type === 'url') return { kind: 'url', url: choice.url };
  if (choice.type === 'file') return { kind: 'file', uploadId: choice.uploadId };
  if (preset.bottom === 'niche' && nicheUrl !== null) return { kind: 'url', url: nicheUrl };
  return { kind: 'source' };
}

export function withBottom(layout: Layout, plan: BottomPlan): Layout {
  if (plan.kind === 'source') return { ...layout, bottom: 'source' };
  const rest: Layout = { ...layout, bottom: 'video' };
  delete rest.bottomArea;
  return rest;
}
