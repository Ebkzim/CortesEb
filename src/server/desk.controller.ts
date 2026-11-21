import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AccountService } from '../accounts/account.service.js';
import { AppError } from '../common/app-error.js';
import { DeskClient, type DeskReply } from '../browser/desk-client.js';
import { LoginWindows, type LoginWindow } from '../browser/login-windows.js';
import { deskInputSchema } from '../browser/remote-desk.js';

const connectSchema = z.strictObject({
  platform: z.literal('tiktok'),
  account: z.string().min(1).max(32),
});

@Controller('api/desk')
export class DeskController {
  constructor(
    private readonly desk: DeskClient,
    private readonly accounts: AccountService,
    private readonly logins: LoginWindows,
  ) {}

  @Get('state')
  async state(@Res() reply: FastifyReply): Promise<void> {
    if (!(await this.desk.available())) {
      await reply.send({ available: false, state: null });
      return;
    }
    const answer = await this.desk.call('GET', '/state');
    const data = JSON.parse(answer.body.toString('utf8')) as Record<string, unknown>;
    await reply.status(answer.status).send({ available: true, ...data });
  }

  @Get('frame')
  async frame(@Res() reply: FastifyReply): Promise<void> {
    await relay(reply, await this.desk.call('GET', '/frame'));
  }

  @Post('input')
  async input(@Body() body: unknown, @Res() reply: FastifyReply): Promise<void> {
    const parsed = deskInputSchema.safeParse(body);
    if (!parsed.success) throw new AppError('INVALID_INPUT', 'comando de tela inválido');
    await relay(reply, await this.desk.call('POST', '/input', parsed.data));
  }

  @Post('cancel')
  async cancel(@Res() reply: FastifyReply): Promise<void> {
    await relay(reply, await this.desk.call('POST', '/cancel', {}));
  }

  @Post('connect')
  async connect(@Body() body: unknown): Promise<LoginWindow> {
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) throw new AppError('INVALID_INPUT', 'conta inválida');
    const known = (await this.accounts.list()).some((item) => item.id === parsed.data.account);
    if (!known) throw new AppError('INVALID_INPUT', 'conta não cadastrada');
    return this.logins.open(parsed.data.platform, parsed.data.account);
  }

  @Get('logins')
  loginList(): LoginWindow[] {
    return this.logins.list();
  }
}

async function relay(reply: FastifyReply, answer: DeskReply): Promise<void> {
  await reply
    .status(answer.status)
    .header('Content-Type', answer.type)
    .header('Cache-Control', 'no-store')
    .send(answer.body);
}
