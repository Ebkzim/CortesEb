import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { JobEvents, type JobEvent } from '../jobs/job-events.js';
import { SESSION_COOKIE, SessionGate } from './session.js';

const HEARTBEAT_MS = 15_000;
export const SESSION_GATE = Symbol('SESSION_GATE');

@Controller('api')
export class SessionController {
  constructor(
    @Inject(SESSION_GATE) private readonly gate: SessionGate,
    private readonly events: JobEvents,
  ) {}

  @Post('session')
  async open(@Body() body: unknown, @Res() reply: FastifyReply): Promise<void> {
    const parsed = z.strictObject({ token: z.string().min(10).max(200) }).safeParse(body);
    if (!parsed.success || !this.gate.matches(parsed.data.token)) {
      throw new AppError(
        'INVALID_INPUT',
        'link de acesso inválido: abra o painel pelo comando cortes-eb ui',
      );
    }
    await reply
      .header(
        'Set-Cookie',
        `${SESSION_COOKIE}=${this.gate.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`,
      )
      .send({ ok: true });
  }

  @Get('session')
  status(): { ok: true } {
    return { ok: true };
  }

  @Get('events')
  stream(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write(': conectado\n\n');
    const send = (event: JobEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = this.events.subscribe(send);
    const heartbeat = setInterval(() => {
      raw.write(': ping\n\n');
    }, HEARTBEAT_MS);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
