import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { ProcessRunner } from '../common/process-runner.js';
import {
  LANGUAGE_PATTERN,
  UserConfigStore,
  WHISPER_MODELS,
  type UserConfig,
} from '../config/user-config.js';
import {
  ApiKeyRepository,
  KEY_PROVIDERS,
  type ApiKeyView,
} from '../database/api-key.repository.js';
import { PrismaService } from '../database/prisma.service.js';
import { llmBaseUrl } from '../llm/llm-url.js';
import { LlmService, OLLAMA_URL } from '../llm/llm.service.js';
import { ollamaModels } from '../llm/ollama-client.js';
import { Whisper } from '../transcription/whisper.js';

const keySchema = z
  .strictObject({
    provider: z.enum(KEY_PROVIDERS),
    label: z.string().trim().min(1).max(80),
    secret: z.string().trim().min(8).max(4096),
    baseUrl: z.string().trim().max(300).optional(),
    model: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((key, context) => {
    if (key.provider === 'compatible' && key.baseUrl === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'informe o endereço do servidor',
      });
    }
    if (key.provider !== 'anthropic' && key.model === undefined) {
      context.addIssue({ code: 'custom', path: ['model'], message: 'informe o modelo' });
    }
  });

const settingsSchema = z.strictObject({
  whisperModel: z.enum(WHISPER_MODELS).optional(),
  language: z.string().regex(LANGUAGE_PATTERN).optional(),
});

const ollamaSchema = z.strictObject({
  model: z.string().trim().min(1).max(100),
  baseUrl: z.string().max(300).optional(),
});

const TEST_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };

@Controller('api')
export class SettingsController {
  private installing: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: ProcessRunner,
    private readonly config: UserConfigStore,
    private readonly keys: ApiKeyRepository,
    private readonly llm: LlmService,
    private readonly whisper: Whisper,
  ) {}

  @Get('health')
  async health(): Promise<Record<string, unknown>> {
    const settings = await this.config.load();
    const [database, ffmpeg, ytdlp, whisper, ollama] = await Promise.all([
      this.prisma.ping(),
      this.runner.has('ffmpeg'),
      this.runner.has('yt-dlp'),
      this.whisper.isReady(settings.whisperModel),
      ollamaModels(OLLAMA_URL)
        .then(() => true)
        .catch(() => false),
    ]);
    return { database, ffmpeg, ytdlp, whisper, ollama, whisperModel: settings.whisperModel };
  }

  @Get('settings')
  async settings(): Promise<Record<string, unknown>> {
    const settings = await this.config.load();
    const installed = await Promise.all(
      WHISPER_MODELS.map(async (model) => ({ model, ready: await this.whisper.isReady(model) })),
    );
    return {
      whisperModel: settings.whisperModel,
      language: settings.language,
      whisperModels: installed,
      installing: this.installing,
    };
  }

  @Patch('settings')
  async update(@Body() body: unknown): Promise<Record<string, unknown>> {
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) throw new AppError('INVALID_INPUT', 'configuração inválida');
    const patch: Partial<UserConfig> = {};
    if (parsed.data.whisperModel !== undefined) patch.whisperModel = parsed.data.whisperModel;
    if (parsed.data.language !== undefined) patch.language = parsed.data.language;
    await this.config.update(patch);
    return this.settings();
  }

  @Post('settings/whisper/:model')
  install(@Param('model') model: string): { installing: string } {
    const parsed = z.enum(WHISPER_MODELS).safeParse(model);
    if (!parsed.success) throw new AppError('INVALID_INPUT', 'modelo desconhecido');
    if (this.installing !== null)
      throw new AppError('INVALID_INPUT', 'já existe uma instalação em andamento');
    this.installing = parsed.data;
    void this.whisper
      .install(parsed.data)
      .catch((error: unknown) => {
        process.stderr.write(
          `falha ao instalar o whisper: ${error instanceof Error ? error.message : ''}\n`,
        );
      })
      .finally(() => {
        this.installing = null;
      });
    return { installing: parsed.data };
  }

  @Get('keys')
  listKeys(): Promise<ApiKeyView[]> {
    return this.keys.list();
  }

  @Post('keys')
  async createKey(@Body() body: unknown): Promise<ApiKeyView> {
    const parsed = keySchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError('INVALID_INPUT', issue?.message ?? 'chave inválida');
    }
    const { baseUrl, model, ...rest } = parsed.data;
    return this.keys.create({
      ...rest,
      baseUrl: baseUrl === undefined ? null : llmBaseUrl(baseUrl),
      model: model ?? null,
    });
  }

  @Delete('keys/:id')
  async removeKey(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ ok: boolean }> {
    return { ok: await this.keys.remove(id) };
  }

  @Post('keys/:id/test')
  async testKey(@Param('id', new ParseUUIDPipe()) id: string): Promise<Record<string, unknown>> {
    const key = await this.keys.reveal(id);
    const client = this.llm.fromSpec({
      provider: key.provider,
      model: key.model,
      baseUrl: key.baseUrl,
      apiKey: key.secret,
    });
    return this.probe(client.label, () =>
      client.complete({
        system: 'Responda com JSON.',
        user: 'Responda {"ok": true}',
        schema: TEST_SCHEMA,
        maxTokens: 20,
      }),
    );
  }

  @Get('ollama')
  async ollama(@Query('baseUrl') baseUrl?: string): Promise<Record<string, unknown>> {
    const url = llmBaseUrl(baseUrl ?? OLLAMA_URL);
    try {
      return { reachable: true, baseUrl: url, models: await ollamaModels(url) };
    } catch {
      return { reachable: false, baseUrl: url, models: [] };
    }
  }

  @Post('ollama/test')
  async testOllama(@Body() body: unknown): Promise<Record<string, unknown>> {
    const parsed = ollamaSchema.safeParse(body);
    if (!parsed.success) throw new AppError('INVALID_INPUT', 'informe o modelo');
    const client = this.llm.fromSpec({
      provider: 'ollama',
      model: parsed.data.model,
      baseUrl: parsed.data.baseUrl ?? null,
      apiKey: null,
    });
    return this.probe(client.label, () =>
      client.complete({
        system: 'Responda com JSON.',
        user: 'Responda {"ok": true}',
        schema: TEST_SCHEMA,
        maxTokens: 20,
      }),
    );
  }

  private async probe(
    label: string,
    call: () => Promise<string>,
  ): Promise<Record<string, unknown>> {
    const started = Date.now();
    try {
      await call();
      return {
        ok: true,
        model: label,
        seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      };
    } catch (error) {
      return {
        ok: false,
        model: label,
        error: error instanceof Error ? error.message.slice(0, 300) : 'falhou',
      };
    }
  }
}
