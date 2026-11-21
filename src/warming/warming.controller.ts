import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { BROWSER_PLATFORMS } from '../browser/browser-sessions.js';
import { ACCOUNT_ID_PATTERN } from '../config/user-config.js';
import { AppError } from '../common/app-error.js';
import type { WarmingSession } from './warming-state.js';
import { WarmingService } from './warming.service.js';

const targetSchema = z.object({
  account: z.string().regex(ACCOUNT_ID_PATTERN),
  platform: z.enum(BROWSER_PLATFORMS),
});
@Controller('api/warming')
export class WarmingController {
  constructor(private readonly service: WarmingService) {}
  @Get()
  list(): Promise<WarmingSession[]> {
    return this.service.list();
  }
  @Get(':account/:platform/frame')
  async frame(
    @Param('account') account: string,
    @Param('platform') platform: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const target = targetSchema.safeParse({ account, platform });
    if (!target.success) throw new AppError('INVALID_INPUT', 'conta ou rede inválida');
    const frame = await this.service.frame(target.data.account, target.data.platform);
    await reply.type('image/jpeg').send(frame);
  }
  @Post(':account/:platform/start')
  start(
    @Param('account') account: string,
    @Param('platform') platform: string,
    @Body() body: unknown,
  ): Promise<WarmingSession> {
    const target = targetSchema.safeParse({ account, platform });
    if (!target.success) throw new AppError('INVALID_INPUT', 'conta ou rede inválida');
    return this.service.start(target.data.account, target.data.platform, body);
  }
  @Post(':account/:platform/resolve')
  resolve(
    @Param('account') account: string,
    @Param('platform') platform: string,
  ): Promise<WarmingSession> {
    const target = targetSchema.safeParse({ account, platform });
    if (!target.success) throw new AppError('INVALID_INPUT', 'conta ou rede inválida');
    return this.service.resolve(target.data.account, target.data.platform);
  }
  @Post(':account/:platform/stop')
  stop(
    @Param('account') account: string,
    @Param('platform') platform: string,
  ): Promise<WarmingSession> {
    const target = targetSchema.safeParse({ account, platform });
    if (!target.success) throw new AppError('INVALID_INPUT', 'conta ou rede inválida');
    return this.service.stop(target.data.account, target.data.platform);
  }
}
