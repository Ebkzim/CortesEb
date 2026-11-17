import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { AppPaths } from '../config/app-paths.js';
import { PrismaService } from './prisma.service.js';
import { hintOf, loadMasterKey, SecretBox } from './secret-box.js';

export const KEY_PROVIDERS = ['openai', 'anthropic', 'compatible'] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];

export interface ApiKeyView {
  id: string;
  provider: KeyProvider;
  label: string;
  baseUrl: string | null;
  model: string | null;
  hint: string;
  createdAt: string;
}

export interface NewApiKey {
  provider: KeyProvider;
  label: string;
  baseUrl?: string | null;
  model?: string | null;
  secret: string;
}

export interface StoredKey extends ApiKeyView {
  secret: string;
}

@Injectable()
export class ApiKeyRepository {
  private box: SecretBox | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paths: AppPaths,
  ) {}

  async create(input: NewApiKey): Promise<ApiKeyView> {
    const box = await this.secretBox();
    const row = await this.prisma.db.apiKey.create({
      data: {
        provider: input.provider,
        label: input.label,
        baseUrl: input.baseUrl ?? null,
        model: input.model ?? null,
        secret: box.seal(input.secret.trim()),
        hint: hintOf(input.secret),
      },
    });
    return view(row);
  }

  async list(): Promise<ApiKeyView[]> {
    const rows = await this.prisma.db.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(view);
  }

  async reveal(id: string): Promise<StoredKey> {
    const row = await this.prisma.db.apiKey.findUnique({ where: { id } });
    if (row === null) throw new AppError('INVALID_INPUT', 'chave não encontrada');
    return { ...view(row), secret: (await this.secretBox()).open(row.secret) };
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.prisma.db.apiKey.deleteMany({ where: { id } });
    return result.count > 0;
  }

  private async secretBox(): Promise<SecretBox> {
    this.box ??= new SecretBox(
      await loadMasterKey(this.paths.home, process.env.CORTES_EB_MASTER_KEY),
    );
    return this.box;
  }
}

function view(row: {
  id: string;
  provider: string;
  label: string;
  baseUrl: string | null;
  model: string | null;
  hint: string;
  createdAt: Date;
}): ApiKeyView {
  const provider = KEY_PROVIDERS.find((item) => item === row.provider) ?? 'compatible';
  return {
    id: row.id,
    provider,
    label: row.label,
    baseUrl: row.baseUrl,
    model: row.model,
    hint: row.hint,
    createdAt: row.createdAt.toISOString(),
  };
}
