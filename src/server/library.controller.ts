import fs from 'node:fs';
import path from 'node:path';
import { Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AppError } from '../common/app-error.js';
import { JobRepository, type DaySummary } from '../database/job.repository.js';
import { clipView, type ClipView } from '../jobs/job-views.js';
import { LibraryService } from '../jobs/library.service.js';
import { parseRange } from './session.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

@Controller('api')
export class LibraryController {
  constructor(
    private readonly jobs: JobRepository,
    private readonly library: LibraryService,
  ) {}

  @Get('library/days')
  days(): Promise<DaySummary[]> {
    return this.jobs.days();
  }

  @Get('clips/recent')
  async recent(@Query('limit') limit?: string): Promise<ClipView[]> {
    return (await this.jobs.recentClips(Number(limit ?? 12) || 12)).map(clipView);
  }

  @Get('library/days/:day')
  async day(@Param('day') day: string): Promise<ClipView[]> {
    if (!DAY.test(day)) throw new AppError('INVALID_INPUT', 'dia inválido');
    return (await this.jobs.clipsOfDay(day)).map(clipView);
  }

  @Get('clips/:id/video')
  async video(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('range') range: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = this.library.absolute((await this.jobs.getClip(id)).file);
    const size = await sizeOf(file);
    const part = parseRange(range, size);
    reply.header('Content-Type', 'video/mp4').header('Accept-Ranges', 'bytes');
    if (part === null) {
      await reply.header('Content-Length', String(size)).send(fs.createReadStream(file));
      return;
    }
    await reply
      .status(206)
      .header('Content-Range', `bytes ${String(part.start)}-${String(part.end)}/${String(size)}`)
      .header('Content-Length', String(part.end - part.start + 1))
      .send(fs.createReadStream(file, { start: part.start, end: part.end }));
  }

  @Get('clips/:id/download')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const clip = await this.jobs.getClip(id);
    const file = this.library.absolute(clip.file);
    const size = await sizeOf(file);
    const name = path.basename(file).replace(/[^A-Za-z0-9._-]/g, '_');
    await reply
      .header('Content-Type', 'video/mp4')
      .header('Content-Length', String(size))
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .send(fs.createReadStream(file));
  }

  @Get('clips/:id/thumb')
  async thumb(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const clip = await this.jobs.getClip(id);
    if (clip.thumb === null) throw new AppError('MISSING_FILE', 'sem miniatura');
    const file = this.library.absolute(clip.thumb);
    await sizeOf(file);
    await reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'private, max-age=86400')
      .send(fs.createReadStream(file));
  }

  @Delete('clips/:id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ ok: true }> {
    await this.library.remove(id);
    return { ok: true };
  }
}

async function sizeOf(file: string): Promise<number> {
  const stat = await fs.promises.stat(file).catch(() => null);
  if (stat === null || !stat.isFile()) throw new AppError('MISSING_FILE', 'arquivo não encontrado');
  return stat.size;
}
