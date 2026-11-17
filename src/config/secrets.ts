import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';

export type SecretName =
  | 'ELEVENLABS_API_KEY'
  | 'GOOGLE_API_KEY'
  | 'GOOGLE_CSE_ID'
  | 'ANTHROPIC_API_KEY'
  | 'CORTES_EB_LLM_API_KEY';

@Injectable()
export class Secrets {
  has(name: SecretName): boolean {
    return this.read(name) !== undefined;
  }

  require(name: SecretName): string {
    const value = this.read(name);
    if (value === undefined) {
      throw new AppError('MISSING_SECRET', `defina a variável de ambiente ${name}`);
    }
    return value;
  }

  private read(name: SecretName): string | undefined {
    const value = process.env[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  }
}
