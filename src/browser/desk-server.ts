import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { writeJson } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import { RemoteDesk } from './remote-desk.js';

export const DESK_HEADER = 'x-cortes-desk';
const MAX_BODY = 8 * 1024;

export interface DeskEndpoint {
  port: number;
  token: string;
  pid: number;
}

export function deskFile(paths: AppPaths): string {
  return path.join(paths.home, 'desk.json');
}

@Injectable()
export class DeskServer {
  private server: http.Server | null = null;
  private token = '';

  constructor(
    private readonly paths: AppPaths,
    private readonly desk: RemoteDesk,
  ) {}

  async start(): Promise<void> {
    if (this.server !== null) return;
    this.token = randomBytes(32).toString('base64url');
    const server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    this.server = server;
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('sem porta');
    const endpoint: DeskEndpoint = { port: address.port, token: this.token, pid: process.pid };
    await writeJson(deskFile(this.paths), endpoint, 0o600);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server === null) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await fs.rm(deskFile(this.paths), { force: true });
  }

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    try {
      if (!this.authorized(request.headers[DESK_HEADER])) {
        send(response, 401, { error: 'sem acesso' });
        return;
      }
      const route = `${request.method ?? 'GET'} ${(request.url ?? '/').split('?')[0] ?? '/'}`;
      switch (route) {
        case 'GET /state':
          send(response, 200, { state: this.desk.state() });
          return;
        case 'GET /frame': {
          const image = await this.desk.frame();
          response.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(image.length),
            'Cache-Control': 'no-store',
          });
          response.end(image);
          return;
        }
        case 'POST /input':
          await this.desk.input(await readBody(request));
          send(response, 200, { ok: true });
          return;
        case 'POST /cancel':
          send(response, 200, { cancelled: this.desk.cancel() });
          return;
        default:
          send(response, 404, { error: 'rota desconhecida' });
      }
    } catch (error) {
      const status = error instanceof AppError && error.code === 'INVALID_INPUT' ? 400 : 500;
      send(response, status, {
        error: error instanceof Error ? (error.message.split('\n')[0] ?? 'erro') : 'erro',
      });
    }
  }

  private authorized(header: string | string[] | undefined): boolean {
    if (typeof header !== 'string' || this.token === '') return false;
    const given = Buffer.from(header);
    const expected = Buffer.from(this.token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(text)),
  });
  response.end(text);
}

async function readBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY) throw new AppError('INVALID_INPUT', 'corpo grande demais');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_INPUT', 'corpo inválido');
  }
}
