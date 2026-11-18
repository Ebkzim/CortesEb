import fs from 'node:fs';
import path from 'node:path';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JobRunner } from '../jobs/job-runner.js';
import { HttpErrors } from './http-errors.js';
import { ServerModule } from './server.module.js';
import { MAX_UPLOAD_BYTES } from './files.controller.js';
import { SESSION_COOKIE, SessionGate } from './session.js';

export interface RunningServer {
  url: string;
  token: string;
  close(): Promise<void>;
}

const BODY_LIMIT = 1024 * 1024;
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function startServer(port: number, webDir: string): Promise<RunningServer> {
  z.config(z.locales.pt());
  const gate = new SessionGate(port);
  const app = await NestFactory.create<NestFastifyApplication>(
    ServerModule.register(gate),
    new FastifyAdapter({ bodyLimit: BODY_LIMIT, trustProxy: false }),
    { logger: ['error', 'warn'] },
  );
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
  });
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!gate.allowedHost(request.headers.host)) {
      await reply.status(421).send({ error: 'endereço não permitido' });
      return reply;
    }
    const url = routePath(request);
    if (!url.startsWith('/api/')) return undefined;
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    if (!SAFE_METHODS.has(request.method) && !gate.allowedOrigin(origin)) {
      await reply.status(403).send({ error: 'origem não permitida' });
      return reply;
    }
    if (url === '/api/session' && request.method === 'POST') return undefined;
    if (!gate.matches(readCookie(request.headers.cookie, SESSION_COOKIE))) {
      await reply
        .status(401)
        .send({ error: 'sessão expirada: abra o painel pelo comando cortes-eb ui' });
      return reply;
    }
    return undefined;
  });
  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=()');
    if (routePath(request).startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: '/',
      index: 'index.html',
      redirect: true,
      dotfiles: 'deny',
    });
  }
  app.useGlobalFilters(new HttpErrors());
  app.enableShutdownHooks();
  await app.listen(port, '127.0.0.1');
  await app.get(JobRunner).start();
  return {
    url: `http://127.0.0.1:${String(port)}`,
    token: gate.token,
    close: () => app.close(),
  };
}

export function routePath(request: FastifyRequest): string {
  const route = request.routeOptions.url ?? '';
  if (route.toLowerCase().startsWith('/api/')) return route;
  const raw = request.url.split('?')[0] ?? '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return '/api/';
  }
  return decoded
    .toLowerCase()
    .replace(/\/{2,}/g, '/')
    .startsWith('/api/')
    ? '/api/'
    : decoded;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}
