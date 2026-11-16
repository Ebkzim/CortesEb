import fs from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { Secrets } from '../config/secrets.js';
import { SFX_NAMES, SfxLibrary, type SfxName } from './sfx-library.js';

const ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL = 'eleven_text_to_sound_v2';
const TIMEOUT_MS = 90_000;
const MAX_BYTES = 5_000_000;
const DURATION_SECONDS = 0.5;
const PROMPT_INFLUENCE = 0.3;

const PROMPTS: Record<SfxName, string> = {
  whoosh: 'Quick airy whoosh for a video transition, clean and short, no voice, no music',
  impact: 'Tight low impact hit with a short sub thump and no tail, no voice, no music',
  pop: 'Soft bright bubble pop for a user interface, very short, no voice, no music',
};

export interface SfxOutcome {
  name: SfxName;
  status: 'created' | 'kept' | 'failed';
  detail?: string;
}

@Injectable()
export class SfxGenerator {
  constructor(
    private readonly secrets: Secrets,
    private readonly library: SfxLibrary,
  ) {}

  async generate(force: boolean): Promise<SfxOutcome[]> {
    const key = this.secrets.require('ELEVENLABS_API_KEY');
    await this.library.ensureFolder();
    const outcomes: SfxOutcome[] = [];
    for (const name of SFX_NAMES) {
      if (!force && (await this.library.locate(name)) !== null) {
        outcomes.push({ name, status: 'kept' });
        continue;
      }
      try {
        await fs.writeFile(this.library.target(name), await this.request(key, PROMPTS[name]));
        outcomes.push({ name, status: 'created' });
      } catch (error) {
        const detail = error instanceof AppError ? error.message : 'falha de rede';
        outcomes.push({ name, status: 'failed', detail });
      }
    }
    return outcomes;
  }

  private async request(key: string, text: string): Promise<Uint8Array> {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        duration_seconds: DURATION_SECONDS,
        prompt_influence: PROMPT_INFLUENCE,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError('REMOTE_FAILED', `ElevenLabs respondeu ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      throw new AppError('REMOTE_FAILED', 'áudio recebido fora do tamanho esperado');
    }
    return bytes;
  }
}
