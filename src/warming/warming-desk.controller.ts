import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { DeskState } from '../browser/remote-desk.js';
import { WarmingDesk } from './warming-desk.js';

@Controller('api/warming/desk')
export class WarmingDeskController {
  constructor(private readonly desk: WarmingDesk) {}
  @Get('state')
  state(): { available: boolean; state: DeskState | null } {
    return { available: true, state: this.desk.state() };
  }
  @Get('frame')
  async frame(@Res() reply: FastifyReply): Promise<void> {
    const frame = await this.desk.frame();
    await reply.type('image/jpeg').send(frame);
  }
  @Post('input')
  async input(@Body() body: unknown): Promise<{ ok: boolean }> {
    await this.desk.input(body);
    return { ok: true };
  }
  @Post('cancel')
  cancel(): { cancelled: boolean } {
    return { cancelled: this.desk.cancel() };
  }
}
