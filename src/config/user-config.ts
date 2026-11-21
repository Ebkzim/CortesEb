import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { layoutSchema } from '../contracts/layout.js';
import { AppPaths } from './app-paths.js';

export const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v3'] as const;

export const ACCOUNT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const MAX_ACCOUNTS = 20;

export const LANGUAGE_PATTERN = /^([a-z]{2,3}|auto)$/;

const accountId = z.string().regex(ACCOUNT_ID_PATTERN);

export const accountSchema = z.strictObject({
  name: z.string().trim().min(1).max(40).optional(),
  logo: z
    .string()
    .regex(/^logo-[a-z0-9-]{1,32}\.(png|jpg|webp)$/)
    .optional(),
});

export const LLM_PROVIDERS = ['agent', 'ollama', 'openai', 'anthropic'] as const;

export const llmSettingsSchema = z.strictObject({
  provider: z.enum(LLM_PROVIDERS).default('agent'),
  model: z.string().trim().min(1).max(100).optional(),
  baseUrl: z.string().max(300).optional(),
});

export const PUBLISH_METHODS = ['api', 'browser'] as const;
export const YOUTUBE_VISIBILITIES = ['public', 'unlisted', 'private'] as const;

export const publishingSchema = z.strictObject({
  instagram: z.enum(PUBLISH_METHODS).default('api'),
  youtube: z.enum(PUBLISH_METHODS).default('browser'),
  youtubeVisibility: z.enum(YOUTUBE_VISIBILITIES).default('public'),
});

export const PUBLISHING_DEFAULTS = publishingSchema.parse({});

export const userConfigSchema = z.strictObject({
  accounts: z.record(accountId, accountSchema).default({}),
  defaultAccount: accountId.optional(),
  whisperModel: z.enum(WHISPER_MODELS).default('small'),
  language: z.string().regex(LANGUAGE_PATTERN).default('pt'),
  sfxGain: z.number().min(0).max(2).default(0.6),
  niche: z
    .preprocess(
      (value) => (value === 'gta6' ? 'gameplay' : value),
      z.string().regex(/^[a-z0-9-]{1,32}$/),
    )
    .default('gameplay'),
  llm: llmSettingsSchema.default({ provider: 'agent' }),
  layout: layoutSchema.default({}),
  publishing: publishingSchema.default(PUBLISHING_DEFAULTS),
});

export type Account = z.infer<typeof accountSchema>;
export type UserConfig = z.infer<typeof userConfigSchema>;
export type Publishing = z.infer<typeof publishingSchema>;
export type PublishMethod = (typeof PUBLISH_METHODS)[number];

const CONFIG_MODE = 0o600;

@Injectable()
export class UserConfigStore {
  constructor(private readonly paths: AppPaths) {}

  async load(): Promise<UserConfig> {
    if (!(await exists(this.paths.configFile))) return userConfigSchema.parse({});
    return readJson(this.paths.configFile, userConfigSchema);
  }

  async update(patch: Partial<UserConfig>): Promise<UserConfig> {
    return this.replace({ ...(await this.load()), ...patch });
  }

  async replace(config: UserConfig): Promise<UserConfig> {
    const next = userConfigSchema.parse(config);
    await writeJson(this.paths.configFile, next, CONFIG_MODE);
    return next;
  }
}
