import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ACCOUNT_ID_PATTERN } from '../config/user-config.js';
import { AppError } from '../common/app-error.js';
import { FollowingService } from './following.service.js';
import type { FollowingSession } from './following-state.js';

function accountId(account: string): string {
  if (!z.string().regex(ACCOUNT_ID_PATTERN).safeParse(account).success)
    throw new AppError('INVALID_INPUT', 'conta inválida');
  return account;
}
export function followingView(session: FollowingSession): Omit<
  FollowingSession,
  'candidates' | 'checked' | 'reels' | 'ledger'
> & {
  pendingCount: number;
} {
  return {
    account: session.account,
    platform: session.platform,
    config: session.config,
    status: session.status,
    counts: session.counts,
    nextAt: session.nextAt,
    startedAt: session.startedAt,
    message: session.message,
    progress: session.progress,
    lastIntervalSeconds: session.lastIntervalSeconds,
    history: session.history,
    pendingCount: session.ledger.filter((entry) => entry.state === 'pending').length,
  };
}

@Controller('api/following')
export class FollowingController {
  constructor(private readonly service: FollowingService) {}
  @Get()
  async list(): Promise<ReturnType<typeof followingView>[]> {
    return (await this.service.list()).map(followingView);
  }
  @Post(':account/start')
  async start(
    @Param('account') account: string,
    @Body() body: unknown,
  ): Promise<ReturnType<typeof followingView>> {
    return followingView(await this.service.start(accountId(account), body));
  }
  @Post(':account/stop')
  async stop(@Param('account') account: string): Promise<ReturnType<typeof followingView>> {
    return followingView(await this.service.stop(accountId(account)));
  }
}
