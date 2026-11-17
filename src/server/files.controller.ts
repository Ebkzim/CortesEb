import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AccountService, type AccountView } from '../accounts/account.service.js';
import { AppError } from '../common/app-error.js';
import { resolveInside } from '../common/safe-path.js';
import { AppPaths } from '../config/app-paths.js';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi']);
const LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const ACCOUNT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

const accountSchema = z.strictObject({
  name: z.string().trim().max(40).nullable().optional(),
});

type UploadedFile = MultipartFile;

@Controller('api')
export class FilesController {
  constructor(
    private readonly paths: AppPaths,
    private readonly accounts: AccountService,
  ) {}

  @Post('uploads')
  async upload(
    @Req() request: FastifyRequest,
  ): Promise<{ uploadId: string; name: string; size: number }> {
    const part = await readPart(request, MAX_UPLOAD_BYTES);
    const extension = path.extname(part.filename).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(extension)) {
      part.file.resume();
      throw new AppError('INVALID_INPUT', `formato não aceito: ${extension || 'nenhum'}`);
    }
    await fs.promises.mkdir(this.paths.uploadsDir, { recursive: true });
    const uploadId = randomUUID();
    const target = resolveInside(this.paths.uploadsDir, `${uploadId}${extension}`);
    const size = await save(part, target);
    return { uploadId, name: part.filename.slice(0, 200), size };
  }

  @Get('accounts')
  listAccounts(): Promise<AccountView[]> {
    return this.accounts.list();
  }

  @Patch('accounts/:id')
  async saveAccount(@Param('id') id: string, @Body() body: unknown): Promise<AccountView> {
    if (!ACCOUNT_ID.test(id)) throw new AppError('INVALID_INPUT', 'id de conta inválido');
    const parsed = accountSchema.safeParse(body);
    if (!parsed.success) throw new AppError('INVALID_INPUT', 'nome inválido');
    const name = parsed.data.name;
    return this.accounts.save(id, name === undefined ? {} : { name: name === '' ? null : name });
  }

  @Post('accounts/:id/logo')
  async logo(@Param('id') id: string, @Req() request: FastifyRequest): Promise<AccountView> {
    if (!ACCOUNT_ID.test(id)) throw new AppError('INVALID_INPUT', 'id de conta inválido');
    const part = await readPart(request, MAX_LOGO_BYTES);
    const extension = path.extname(part.filename).toLowerCase();
    if (!LOGO_EXTENSIONS.has(extension)) {
      part.file.resume();
      throw new AppError('INVALID_INPUT', 'a logo precisa ser png, jpg ou webp');
    }
    await fs.promises.mkdir(this.paths.uploadsDir, { recursive: true });
    const temp = resolveInside(this.paths.uploadsDir, `logo-${randomUUID()}${extension}`);
    try {
      await save(part, temp);
      return await this.accounts.save(id, { logo: temp });
    } finally {
      await fs.promises.rm(temp, { force: true });
    }
  }

  @Post('accounts/:id/default')
  defaultAccount(@Param('id') id: string): Promise<AccountView> {
    return this.accounts.setDefault(id);
  }

  @Delete('accounts/:id')
  removeAccount(@Param('id') id: string): Promise<AccountView[]> {
    return this.accounts.remove(id);
  }

  @Get('accounts/:id/logo')
  async logoImage(@Param('id') id: string, @Res() reply: FastifyReply): Promise<void> {
    const account = (await this.accounts.list()).find((item) => item.id === id);
    const file = account === undefined ? null : await this.accounts.logoFile(account);
    if (file === null) throw new AppError('MISSING_FILE', 'sem logo');
    const type = file.endsWith('.png')
      ? 'image/png'
      : file.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    await reply.header('Content-Type', type).send(fs.createReadStream(file));
  }
}

async function readPart(request: FastifyRequest, limit: number): Promise<UploadedFile> {
  if (!request.isMultipart()) throw new AppError('INVALID_INPUT', 'envio sem arquivo');
  const part = await request.file({ limits: { fileSize: limit, files: 1 } });
  if (part === undefined) throw new AppError('INVALID_INPUT', 'envio sem arquivo');
  return part;
}

async function save(part: UploadedFile, target: string): Promise<number> {
  try {
    await pipeline(part.file, fs.createWriteStream(target, { mode: 0o600 }));
  } catch {
    await fs.promises.rm(target, { force: true });
    throw new AppError('INVALID_INPUT', 'o envio foi interrompido');
  }
  if (part.file.truncated) {
    await fs.promises.rm(target, { force: true });
    throw new AppError('INVALID_INPUT', 'arquivo grande demais');
  }
  return (await fs.promises.stat(target)).size;
}
