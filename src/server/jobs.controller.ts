import fs from 'node:fs';
import path from 'node:path';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AppError } from '../common/app-error.js';
import { assertPlainName, resolveInside } from '../common/safe-path.js';
import { percentRectSchema } from '../contracts/job.js';
import { JobRepository } from '../database/job.repository.js';
import { JobRunner } from '../jobs/job-runner.js';
import {
  batchView,
  clipView,
  jobView,
  type BatchView,
  type ClipView,
  type JobView,
} from '../jobs/job-views.js';
import { PRESETS, type Preset } from '../jobs/presets.js';

@Controller('api')
export class JobsController {
  constructor(
    private readonly runner: JobRunner,
    private readonly jobs: JobRepository,
  ) {}

  @Get('presets')
  async presets(): Promise<(Preset & { example: string | null })[]> {
    const examples: Record<string, string> = await this.jobs.examples().catch(() => ({}));
    return PRESETS.map((preset) => ({ ...preset, example: examples[preset.id] ?? null }));
  }

  @Get('jobs')
  async list(@Query('limit') limit?: string): Promise<{
    jobs: JobView[];
    active: string | null;
    covers: Record<string, { clipId: string; count: number }>;
  }> {
    const rows = await this.jobs.list(Number(limit ?? 30) || 30);
    const covers = await this.jobs.covers(rows.map((row) => row.id));
    return { jobs: rows.map(jobView), active: this.runner.activeId(), covers };
  }

  @Post('jobs')
  async create(@Body() body: unknown): Promise<JobView> {
    return jobView(await this.runner.submit(body));
  }

  @Post('batches')
  async createBatch(@Body() body: unknown): Promise<{ batch: BatchView; jobs: JobView[] }> {
    const { batch, jobs } = await this.runner.submitBatch(body);
    return {
      batch: batchView(
        batch,
        jobs.map((job) => job.status),
      ),
      jobs: jobs.map(jobView),
    };
  }

  @Get('batches')
  async batches(@Query('limit') limit?: string): Promise<BatchView[]> {
    const rows = await this.jobs.listBatches(Number(limit ?? 20) || 20);
    return rows.map((row) =>
      batchView(
        row,
        row.jobs.map((job) => job.status),
      ),
    );
  }

  @Get('batches/:id')
  async batch(@Param('id', new ParseUUIDPipe()) id: string): Promise<{
    batch: BatchView;
    jobs: JobView[];
    clips: ClipView[];
  }> {
    const [batch, jobs] = await Promise.all([this.jobs.getBatch(id), this.jobs.jobsOfBatch(id)]);
    const clips = await this.jobs.clipsOfJobs(jobs.map((job) => job.id));
    return {
      batch: batchView(
        batch,
        jobs.map((job) => job.status),
      ),
      jobs: jobs.map(jobView),
      clips: clips.map(clipView),
    };
  }

  @Post('batches/:id/cancel')
  async cancelBatch(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ canceled: number }> {
    await this.jobs.getBatch(id);
    return { canceled: await this.runner.cancelBatch(id) };
  }

  @Delete('batches/:id')
  async forgetBatch(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ ok: true }> {
    await this.jobs.getBatch(id);
    await this.runner.forgetBatch(id);
    return { ok: true };
  }

  @Get('jobs/:id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<{
    job: JobView;
    clips: ClipView[];
    logs: { level: string; message: string; at: string }[];
  }> {
    const [job, clips, logs] = await Promise.all([
      this.jobs.get(id),
      this.jobs.clipsOfJob(id),
      this.jobs.logs(id, 100),
    ]);
    return {
      job: jobView(job),
      clips: clips.map(clipView),
      logs: logs.reverse().map((row) => ({
        level: row.level,
        message: row.message,
        at: row.createdAt.toISOString(),
      })),
    };
  }

  @Delete('jobs/:id')
  async forget(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ ok: true }> {
    await this.runner.forget(id);
    return { ok: true };
  }

  @Delete('jobs')
  async forgetFinished(): Promise<{ removed: number }> {
    return { removed: await this.runner.forgetFinished() };
  }

  @Post('jobs/:id/cancel')
  async cancel(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ ok: true }> {
    await this.runner.cancel(id);
    return { ok: true };
  }

  @Post('jobs/:id/retry')
  async retry(@Param('id', new ParseUUIDPipe()) id: string): Promise<JobView> {
    return jobView(await this.runner.retry(id));
  }

  @Post('jobs/:id/camera')
  camera(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown): { ok: true } {
    const parsed = percentRectSchema.safeParse(body);
    if (!parsed.success) throw new AppError('INVALID_INPUT', 'enquadramento inválido');
    this.runner.provideCamera(id, parsed.data);
    return { ok: true };
  }

  @Get('jobs/:id/frame/:name')
  async frame(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('name') name: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!/^frame-[a-z-]+\.jpg$/.test(name)) throw new AppError('INVALID_INPUT', 'imagem inválida');
    const job = await this.jobs.get(id);
    const file = resolveInside(path.join(job.workDir, 'work'), assertPlainName(name));
    if (!fs.existsSync(file)) throw new AppError('MISSING_FILE', 'imagem não encontrada');
    await reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'no-store')
      .send(fs.createReadStream(file));
  }
}
