import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppPaths } from '../config/app-paths.js';
import type { JobRepository, JobRow } from '../database/job.repository.js';
import type { CutPipeline } from './cut-pipeline.js';
import { JobEvents } from './job-events.js';
import { JobRunner } from './job-runner.js';
import type { LibraryService } from './library.service.js';
import type { LivePipeline } from './live-pipeline.js';
import type { Pipeline, PipelineContext } from './pipeline-context.js';
import type { JobStepId } from './step-tracker.js';

interface Gate {
  open: () => void;
  context: PipelineContext;
}

class FakeRepository {
  rows: JobRow[] = [];
  batches: { id: string; title: string; preset: string; createdAt: Date }[] = [];
  private clock = 0;

  create(input: Partial<JobRow> & { id: string }): Promise<JobRow> {
    this.clock += 1;
    const row = {
      status: 'queued',
      steps: [],
      waiting: null,
      summary: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      batchId: null,
      createdAt: new Date(this.clock),
      updatedAt: new Date(this.clock),
      ...input,
    } as JobRow;
    this.rows.push(row);
    return Promise.resolve(row);
  }

  get(id: string): Promise<JobRow> {
    const row = this.rows.find((item) => item.id === id);
    if (row === undefined) throw new Error('missing');
    return Promise.resolve(row);
  }

  update(id: string, patch: Record<string, unknown>): Promise<JobRow> {
    const row = this.rows.find((item) => item.id === id);
    if (row === undefined) throw new Error('missing');
    Object.assign(row, patch);
    return Promise.resolve(row);
  }

  nextQueued(kind: string, skip: readonly string[] = []): Promise<JobRow | null> {
    return Promise.resolve(
      this.rows.find(
        (row) => row.status === 'queued' && row.kind === kind && !skip.includes(row.id),
      ) ?? null,
    );
  }

  queued(kind: string, skip: readonly string[] = [], take = 50): Promise<JobRow[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.status === 'queued' && row.kind === kind && !skip.includes(row.id))
        .slice(0, take),
    );
  }

  interruptRunning(): Promise<number> {
    return Promise.resolve(0);
  }

  log(): Promise<void> {
    return Promise.resolve();
  }

  createBatch(input: {
    title: string;
    preset: string;
  }): Promise<{ id: string; title: string; preset: string; createdAt: Date }> {
    const batch = { id: `b${String(this.batches.length + 1)}`, createdAt: new Date(), ...input };
    this.batches.push(batch);
    return Promise.resolve(batch);
  }

  jobsOfBatch(batchId: string): Promise<JobRow[]> {
    return Promise.resolve(this.rows.filter((row) => row.batchId === batchId));
  }
}

class FakePipeline implements Pipeline {
  readonly gates = new Map<string, Gate>();
  readonly order: string[] = [];

  steps(): JobStepId[] {
    return ['download'];
  }

  run(context: PipelineContext): Promise<Record<string, unknown>> {
    this.order.push(context.job.title);
    return new Promise((resolve) => {
      this.gates.set(context.job.title, {
        context,
        open: () => {
          resolve({});
        },
      });
    });
  }
}

const VIDEO = { type: 'youtube', url: 'https://www.youtube.com/watch?v=abc' };
const LIVE = { type: 'live', platform: 'twitch', url: 'https://www.twitch.tv/alguem' };
const OLLAMA = { kind: 'ollama', model: 'qwen' };
const TARGETS = { mode: 'count', count: 1 };
const API = { kind: 'api', keyId: '6f1c1d52-8a5e-4f0e-9b7a-0c5b8e2f4a11' };

function setup(): {
  repo: FakeRepository;
  cut: FakePipeline;
  live: FakePipeline;
  runner: JobRunner;
} {
  const repo = new FakeRepository();
  const cut = new FakePipeline();
  const live = new FakePipeline();
  const paths = { jobsDir: path.join(os.tmpdir(), 'cortes-runner-spec') } as AppPaths;
  const runner = new JobRunner(
    repo as unknown as JobRepository,
    new JobEvents(),
    {} as LibraryService,
    cut as unknown as CutPipeline,
    live as unknown as LivePipeline,
    paths,
  );
  return { repo, cut, live, runner };
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('a condição não aconteceu');
}

const running: JobRunner[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((runner) => runner.onModuleDestroy()));
});

describe('JobRunner lanes', () => {
  it('runs lives beside cuts and one cut at a time', async () => {
    const { cut, live, runner, repo } = setup();
    running.push(runner);
    await runner.submit({
      preset: 'react',
      source: VIDEO,
      targets: TARGETS,
      selector: OLLAMA,
      title: 'a',
    });
    await runner.submit({
      preset: 'react',
      source: VIDEO,
      targets: TARGETS,
      selector: OLLAMA,
      title: 'b',
    });
    await runner.submit({
      preset: 'react',
      source: LIVE,
      targets: TARGETS,
      selector: { kind: 'rules' },
      title: 'live',
    });
    await runner.start();
    await until(() => cut.gates.has('a') && live.gates.has('live'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(cut.gates.has('b')).toBe(false);
    cut.gates.get('a')?.open();
    await until(() => cut.gates.has('b'));
    expect(repo.rows.find((row) => row.title === 'a')?.status).toBe('done');
    expect(repo.rows.find((row) => row.title === 'live')?.status).toBe('running');
    cut.gates.get('b')?.open();
    live.gates.get('live')?.open();
    await until(() => repo.rows.every((row) => row.status === 'done'));
  });

  it('lets the next cut run while one waits for the camera, then resumes it', async () => {
    const { cut, runner, repo } = setup();
    running.push(runner);
    await runner.submit({
      preset: 'gameplay-camera',
      source: VIDEO,
      targets: TARGETS,
      selector: OLLAMA,
      title: 'a',
    });
    await runner.submit({
      preset: 'gameplay-camera',
      source: VIDEO,
      targets: TARGETS,
      selector: OLLAMA,
      title: 'b',
    });
    await runner.start();
    await until(() => cut.gates.has('a'));
    const first = cut.gates.get('a');
    let framed = false;
    void first?.context.waitForCamera('frame.jpg', { x: 0, y: 0, w: 50, h: 50 }).then(() => {
      framed = true;
    });
    await until(() => cut.gates.has('b'));
    expect(repo.rows.find((row) => row.title === 'a')?.status).toBe('waiting');
    const id = repo.rows.find((row) => row.title === 'a')?.id ?? '';
    runner.provideCamera(id, { x: 1, y: 1, w: 40, h: 40 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(framed).toBe(false);
    cut.gates.get('b')?.open();
    await until(() => framed);
    expect(repo.rows.find((row) => row.title === 'a')?.status).toBe('running');
    first?.open();
    await until(() => repo.rows.every((row) => row.status === 'done'));
  });
});

describe('JobRunner batches', () => {
  it('alternates the accounts so every one gets clips early', async () => {
    const { runner, repo } = setup();
    const { batch, jobs } = await runner.submitBatch({
      preset: 'react',
      targets: TARGETS,
      selector: OLLAMA,
      items: [
        { account: 'conta-x', videos: [{ source: VIDEO }, { source: VIDEO }, { source: VIDEO }] },
        { account: 'conta-y', videos: [{ source: VIDEO, selector: API }] },
        { account: null, videos: [{ source: VIDEO }, { source: LIVE }] },
      ],
    });
    expect(jobs.map((job) => job.title.split(' · ')[0])).toEqual([
      'conta-x',
      'conta-y',
      'sem conta',
      'conta-x',
      'sem conta',
      'conta-x',
    ]);
    expect(jobs.every((job) => job.batchId === batch.id)).toBe(true);
    expect(jobs.map((job) => job.kind)).toContain('live');
    expect((jobs[0]?.request as { accounts: string[] }).accounts).toEqual(['conta-x']);
    expect((jobs[2]?.request as { accounts: string[] }).accounts).toEqual([]);
    expect((jobs[1]?.request as { selector: unknown }).selector).toEqual(API);
    expect((jobs[0]?.request as { selector: unknown }).selector).toEqual(OLLAMA);
    expect(await runner.cancelBatch(batch.id)).toBe(6);
    expect(repo.rows.every((row) => row.status === 'canceled')).toBe(true);
  });

  it('runs every video of a together batch at the same time', async () => {
    const { cut, runner, repo } = setup();
    running.push(runner);
    await runner.submit({
      preset: 'react',
      source: VIDEO,
      targets: TARGETS,
      selector: OLLAMA,
      title: 'sozinho',
    });
    const { jobs } = await runner.submitBatch({
      preset: 'react',
      targets: TARGETS,
      selector: OLLAMA,
      mode: 'together',
      items: [
        { account: 'conta-x', videos: [{ source: VIDEO }, { source: VIDEO }] },
        { account: 'conta-y', videos: [{ source: VIDEO }] },
      ],
    });
    expect(jobs.every((job) => (job.request as { together?: boolean }).together === true)).toBe(
      true,
    );
    await runner.start();
    await until(() => cut.gates.size === 4);
    for (const gate of cut.gates.values()) gate.open();
    await until(() => repo.rows.every((row) => row.status === 'done'));
  });

  it('refuses the chat agent and sources the type does not take', async () => {
    const { runner, repo } = setup();
    const base = {
      preset: 'react',
      targets: TARGETS,
      items: [{ account: null, videos: [{ source: VIDEO }] }],
    };
    await expect(
      runner.submitBatch({ ...base, selector: { kind: 'agent', agent: 'claude' } }),
    ).rejects.toThrow(/sozinha/);
    await expect(
      runner.submitBatch({
        ...base,
        preset: 'series',
        selector: OLLAMA,
        items: [{ account: null, videos: [{ source: VIDEO }, { source: LIVE }] }],
      }),
    ).rejects.toThrow(/não aceita/);
    await expect(
      runner.submitBatch({
        ...base,
        selector: OLLAMA,
        items: [
          {
            account: null,
            videos: [{ source: VIDEO, selector: { kind: 'agent', agent: 'codex' } }],
          },
        ],
      }),
    ).rejects.toThrow(/sozinha/);
    expect(repo.rows).toEqual([]);
    expect(repo.batches).toEqual([]);
  });
});
