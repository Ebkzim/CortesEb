export const JOB_STEPS = [
  'download',
  'bottom',
  'camera',
  'transcribe',
  'select',
  'render',
  'organize',
  'live',
] as const;

export type JobStepId = (typeof JOB_STEPS)[number];

export const STEP_LABELS: Record<JobStepId, string> = {
  download: 'Baixando o vídeo',
  bottom: 'Preparando o vídeo de baixo',
  camera: 'Enquadramento',
  transcribe: 'Transcrevendo',
  select: 'Escolhendo os cortes',
  render: 'Renderizando',
  organize: 'Organizando em Meus clipes',
  live: 'Acompanhando a live',
};

export type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed';

export interface StepState {
  id: JobStepId;
  label: string;
  status: StepStatus;
  fraction: number | null;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  estimateSeconds: number | null;
  remainingSeconds: number | null;
}

const MIN_FRACTION_FOR_ETA = 0.05;

export class StepTracker {
  private readonly steps: StepState[];

  constructor(
    ids: readonly JobStepId[],
    private readonly onChange: (steps: StepState[]) => void,
    private readonly clock: () => number = Date.now,
  ) {
    this.steps = ids.map((id) => ({
      id,
      label: STEP_LABELS[id],
      status: 'pending',
      fraction: null,
      message: '',
      startedAt: null,
      finishedAt: null,
      estimateSeconds: null,
      remainingSeconds: null,
    }));
  }

  has(id: JobStepId): boolean {
    return this.steps.some((step) => step.id === id);
  }

  estimate(id: JobStepId, seconds: number | null): void {
    this.patch(id, { estimateSeconds: seconds === null ? null : Math.round(seconds) }, false);
  }

  start(id: JobStepId, message = ''): void {
    this.patch(id, {
      status: 'running',
      startedAt: new Date(this.clock()).toISOString(),
      fraction: 0,
      message,
    });
  }

  update(id: JobStepId, fraction: number | null, message: string): void {
    const step = this.find(id);
    if (step === undefined) return;
    if (step.status === 'pending') this.start(id, message);
    this.patch(id, {
      status: 'running',
      fraction: fraction === null ? step.fraction : Math.max(0, Math.min(1, fraction)),
      message,
    });
  }

  wait(id: JobStepId, message: string): void {
    const step = this.find(id);
    if (step?.status === 'pending') this.start(id, message);
    this.patch(id, { status: 'waiting', message });
  }

  finish(id: JobStepId, message = ''): void {
    this.patch(id, {
      status: 'done',
      fraction: 1,
      finishedAt: new Date(this.clock()).toISOString(),
      remainingSeconds: 0,
      ...(message === '' ? {} : { message }),
    });
  }

  skip(id: JobStepId, message = ''): void {
    this.patch(id, { status: 'skipped', message, remainingSeconds: 0 });
  }

  fail(message: string): void {
    const current = this.steps.find(
      (step) => step.status === 'running' || step.status === 'waiting',
    );
    if (current !== undefined) this.patch(current.id, { status: 'failed', message });
  }

  snapshot(): StepState[] {
    return this.steps.map((step) => ({ ...step, remainingSeconds: this.remaining(step) }));
  }

  totalRemaining(): number | null {
    let total = 0;
    for (const step of this.snapshot()) {
      if (step.status === 'done' || step.status === 'skipped') continue;
      if (step.status === 'waiting') return null;
      if (step.remainingSeconds === null) return null;
      total += step.remainingSeconds;
    }
    return Math.round(total);
  }

  private remaining(step: StepState): number | null {
    if (step.status === 'done' || step.status === 'skipped') return 0;
    if (step.status === 'waiting' || step.status === 'failed') return null;
    if (step.status === 'running' && step.startedAt !== null) {
      const elapsed = (this.clock() - Date.parse(step.startedAt)) / 1000;
      const fraction = step.fraction ?? 0;
      if (fraction >= MIN_FRACTION_FOR_ETA) {
        return Math.max(0, Math.round((elapsed / fraction) * (1 - fraction)));
      }
      if (step.estimateSeconds !== null)
        return Math.max(0, Math.round(step.estimateSeconds - elapsed));
      return null;
    }
    return step.estimateSeconds;
  }

  private find(id: JobStepId): StepState | undefined {
    return this.steps.find((step) => step.id === id);
  }

  private patch(id: JobStepId, patch: Partial<StepState>, notify = true): void {
    const index = this.steps.findIndex((step) => step.id === id);
    const current = this.steps[index];
    if (current === undefined) return;
    this.steps[index] = { ...current, ...patch };
    if (notify) this.onChange(this.snapshot());
  }
}
