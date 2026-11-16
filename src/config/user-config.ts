import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { exists, readJson, writeJson } from '../common/json-file.js';
import { AppPaths } from './app-paths.js';

export const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v3'] as const;

export const LOGO_PATTERN = /^logo\.(png|jpg|jpeg|webp)$/;

export const userConfigSchema = z.strictObject({
  profileName: z.string().trim().min(1).max(40).optional(),
  logo: z.string().regex(LOGO_PATTERN).optional(),
  whisperModel: z.enum(WHISPER_MODELS).default('small'),
  language: z
    .string()
    .regex(/^[a-z]{2,3}$/)
    .default('pt'),
  sfxGain: z.number().min(0).max(2).default(0.6),
  niche: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .default('gta6'),
});

export type UserConfig = z.infer<typeof userConfigSchema>;

const CONFIG_MODE = 0o600;

@Injectable()
export class UserConfigStore {
  constructor(private readonly paths: AppPaths) {}

  async load(): Promise<UserConfig> {
    if (!(await exists(this.paths.configFile))) return userConfigSchema.parse({});
    return readJson(this.paths.configFile, userConfigSchema);
  }

  async update(patch: Partial<UserConfig>): Promise<UserConfig> {
    const next = userConfigSchema.parse({ ...(await this.load()), ...patch });
    await writeJson(this.paths.configFile, next, CONFIG_MODE);
    return next;
  }
}
