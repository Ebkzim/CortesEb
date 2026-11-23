import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { readJson } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import { DESK_HEADER, deskFile } from './desk-server.js';

const endpointSchema = z.strictObject({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(20).max(200),
  pid: z.number().int().positive(),
});

const TIMEOUT_MS = 15_000;

export interface DeskReply {
  status: number;
  type: string;
  body: Buffer;
}

@Injectable()
export class DeskClient {
  constructor(private readonly paths: AppPaths) {}

  async available(): Promise<boolean> {
    return (await this.endpoint()) !== null;
  }

  async call(method: 'GET' | 'POST', route: string, body?: unknown): Promise<DeskReply> {
    const endpoint = await this.endpoint();
    if (endpoint === null) {
      throw new AppError(
        'NOT_CONFIGURED',
        process.platform === 'win32'
          ? 'o serviço de postagem está desligado; deixe um terminal aberto com cortes-eb queue run --live'
          : 'o serviço de postagem está desligado; rode cortes-eb service install',
      );
    }
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${String(endpoint.port)}${route}`, {
        method,
        headers: {
          [DESK_HEADER]: endpoint.token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new AppError('REMOTE_FAILED', 'não consegui falar com o serviço de postagem');
    }
    return {
      status: response.status,
      type: response.headers.get('content-type') ?? 'application/octet-stream',
      body: Buffer.from(await response.arrayBuffer()),
    };
  }

  private async endpoint(): Promise<z.infer<typeof endpointSchema> | null> {
    const data = await readJson(deskFile(this.paths), endpointSchema).catch(() => null);
    if (data === null) return null;
    try {
      process.kill(data.pid, 0);
      return data;
    } catch (error) {
      return (error as { code?: unknown }).code === 'EPERM' ? data : null;
    }
  }
}
