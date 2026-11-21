export type PresetId = 'gameplay-camera' | 'react' | 'filmes' | 'series' | 'podcast';

export type PlatformId = 'twitch' | 'kick' | 'youtube';

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  niche: string;
  camera: 'ask' | 'none' | 'fixed';
  bottom: 'source' | 'niche';
  sources: ('file' | 'youtube' | 'vod' | 'live')[];
  group: 'filmes' | 'series' | null;
  variant: 'react' | 'cena' | null;
  frame: 'split' | 'fit';
  top: string;
  below: string;
}

export interface PercentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type JobSource =
  | { type: 'file'; uploadId: string }
  | { type: 'youtube'; url: string }
  | { type: 'vod'; platform: PlatformId; url: string; from?: number; to?: number }
  | { type: 'live'; platform: PlatformId; url: string };

export type JobBottom =
  | { type: 'default' }
  | { type: 'source' }
  | { type: 'url'; url: string }
  | { type: 'file'; uploadId: string };

export type JobTargets =
  { mode: 'count'; count: number } | { mode: 'duration'; minSeconds: number; maxSeconds: number };

export type JobSelector =
  | { kind: 'api'; keyId: string; model?: string }
  | { kind: 'ollama'; model: string; baseUrl?: string }
  | { kind: 'agent'; agent: 'claude' | 'codex' }
  | { kind: 'rules' };

export interface JobRequest {
  title?: string;
  preset: PresetId;
  source: JobSource;
  targets: JobTargets;
  selector: JobSelector;
  accounts?: string[];
  bottom?: JobBottom;
}

export type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed';

export interface StepState {
  id: string;
  label: string;
  status: StepStatus;
  fraction: number | null;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  estimateSeconds: number | null;
  remainingSeconds: number | null;
}

export interface CameraTimeline {
  duration: number;
  at: number;
  strip: { name: string; at: number }[];
}

export type Waiting =
  | ({ kind: 'camera'; frame: string; suggestion: PercentRect } & Partial<CameraTimeline>)
  | {
      kind: 'agent';
      agent: 'claude' | 'codex';
      prompt: string;
      workDir: string;
      problems: string[];
    };

export interface JobView {
  id: string;
  kind: 'cut' | 'live';
  status: 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'canceled' | 'interrupted';
  title: string;
  preset: PresetId;
  request: JobRequest;
  steps: StepState[];
  waiting: Waiting | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  batchId: string | null;
}

export interface ClipView {
  id: string;
  jobId: string | null;
  day: string;
  title: string;
  hook: string | null;
  score: number | null;
  seconds: number;
  sizeBytes: number;
  account: string | null;
  hasThumb: boolean;
  createdAt: string;
}

export interface LogLine {
  level: 'info' | 'warn' | 'error';
  message: string;
  at: string;
}

export interface DaySummary {
  day: string;
  clips: number;
  bytes: number;
}

export interface ApiKeyView {
  id: string;
  provider: 'openai' | 'anthropic' | 'compatible';
  label: string;
  baseUrl: string | null;
  model: string | null;
  hint: string;
  createdAt: string;
}

export interface AccountView {
  id: string;
  name: string | null;
  logo: string | null;
  isDefault: boolean;
}

export type JobEvent =
  | { type: 'job'; jobId: string; job: JobView }
  | { type: 'steps'; jobId: string; steps: StepState[]; remainingSeconds: number | null }
  | { type: 'log'; jobId: string; level: LogLine['level']; message: string; at: string }
  | { type: 'clip'; jobId: string; clip: ClipView }
  | { type: 'removed'; jobId: string };

export interface BatchView {
  id: string;
  title: string;
  preset: string;
  createdAt: string;
  total: number;
  finished: number;
  active: number;
}

export type PublishPlatform = 'instagram' | 'youtube' | 'tiktok';
export type PublishMethod = 'api' | 'browser';

export interface PublishingSettings {
  instagram: PublishMethod;
  youtube: PublishMethod;
  youtubeVisibility: 'public' | 'unlisted' | 'private';
}

export interface PublishTarget {
  account: string;
  platforms: PublishPlatform[];
}

export interface PublishStatus {
  worker: { running: boolean; pid: number | null };
  service: { supported: boolean; installed: boolean; active: boolean; unitFile: string | null };
  targets: PublishTarget[];
  accounts: string[];
  methods: Record<PublishPlatform, PublishMethod>;
}

export interface PublishOutcome {
  queued: { id: string; platform: PublishPlatform; scheduledAt: string | null }[];
  workerRunning: boolean;
}

export interface DeskState {
  id: string;
  reason: 'captcha' | 'login' | 'verify';
  platform: PublishPlatform;
  account: string;
  message: string;
  since: string;
  width: number;
  height: number;
}

export interface DeskSnapshot {
  available: boolean;
  state: DeskState | null;
}

export interface LoginWindowView {
  platform: PublishPlatform;
  account: string;
  phase: 'open' | 'checking' | 'connected' | 'failed';
  startedAt: string;
  message: string | null;
}
