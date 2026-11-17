import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { assertPlainName, resolveInside } from '../common/safe-path.js';

export const HOME_ENV = 'CORTES_EB_HOME';
const HOME_FOLDER = '.cortes-eb';

@Injectable()
export class AppPaths {
  readonly home: string;
  readonly packageRoot: string;

  constructor() {
    this.home = resolveHome(process.env[HOME_ENV]);
    this.packageRoot = fileURLToPath(new URL('../..', import.meta.url));
  }

  get configFile(): string {
    return path.join(this.home, 'config.json');
  }

  get whisperDir(): string {
    return path.join(this.home, 'whisper.cpp');
  }

  get queueFile(): string {
    return path.join(this.home, 'queue.json');
  }

  get outboxDir(): string {
    return path.join(this.home, 'outbox');
  }

  get credentialsFile(): string {
    return path.join(this.home, 'credentials.json');
  }

  get sfxDir(): string {
    return path.join(this.home, 'sfx');
  }

  get bundleDir(): string {
    return path.join(this.home, 'bundle');
  }

  get remotionEntry(): string {
    return path.join(this.packageRoot, 'remotion', 'index.ts');
  }

  get fontsDir(): string {
    return path.join(this.packageRoot, 'assets', 'fonts');
  }

  get skillDir(): string {
    return path.join(this.packageRoot, 'skill');
  }

  inHome(name: string): string {
    return resolveInside(this.home, assertPlainName(name));
  }

  whisperModel(model: string): string {
    return resolveInside(this.whisperDir, assertPlainName(`ggml-${model}.bin`));
  }
}

export function resolveHome(override: string | undefined): string {
  if (override === undefined || override === '') return path.join(os.homedir(), HOME_FOLDER);
  if (!path.isAbsolute(override)) {
    throw new AppError('INVALID_INPUT', `${HOME_ENV} precisa ser um caminho absoluto`);
  }
  return path.resolve(override);
}
