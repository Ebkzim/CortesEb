import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AppError, type ErrorCode } from '../common/app-error.js';

const STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  UNSAFE_PATH: 400,
  UNSAFE_URL: 400,
  MISSING_FILE: 404,
  NOT_CONFIGURED: 409,
  MISSING_SECRET: 409,
  MISSING_DEPENDENCY: 503,
  PROCESS_FAILED: 502,
  REMOTE_FAILED: 502,
};

@Catch()
export class HttpErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (reply.sent) return;
    if (error instanceof AppError) {
      void reply.status(STATUS[error.code]).send({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof HttpException) {
      void reply.status(error.getStatus()).send({ error: error.message });
      return;
    }
    process.stderr.write(
      `erro interno: ${error instanceof Error ? error.message : 'desconhecido'}\n`,
    );
    void reply.status(500).send({ error: 'erro interno do servidor' });
  }
}
