import { Injectable } from '@nestjs/common';
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
  type Language,
} from '@remotion/install-whisper-cpp';
import { AppError } from '../common/app-error.js';
import { currentSignal } from '../common/cancellation.js';
import { exists } from '../common/json-file.js';
import { AppPaths } from '../config/app-paths.js';
import type { UserConfig } from '../config/user-config.js';
import type { Word } from '../contracts/media.js';
import { dropLoops, dropMarkers, mergeTokens } from './tokens.js';

export const WHISPER_VERSION = '1.5.5';
const NO_CONTEXT_ARGS = ['--max-context', '0'];

@Injectable()
export class Whisper {
  constructor(private readonly paths: AppPaths) {}

  isReady(model: UserConfig['whisperModel']): Promise<boolean> {
    return exists(this.paths.whisperModel(model));
  }

  async install(model: UserConfig['whisperModel']): Promise<void> {
    await installWhisperCpp({ to: this.paths.whisperDir, version: WHISPER_VERSION });
    await downloadWhisperModel({ model, folder: this.paths.whisperDir, printOutput: false });
  }

  async transcribe(
    audio: string,
    model: UserConfig['whisperModel'],
    language: string,
    onProgress?: (fraction: number) => void,
  ): Promise<Word[]> {
    if (!(await this.isReady(model))) {
      throw new AppError('NOT_CONFIGURED', `modelo ${model} não instalado: rode cortes-eb setup`);
    }
    const signal = currentSignal();
    const output = await transcribe({
      inputPath: audio,
      whisperPath: this.paths.whisperDir,
      whisperCppVersion: WHISPER_VERSION,
      model,
      tokenLevelTimestamps: true,
      language: language as Language,
      printOutput: false,
      additionalArgs: NO_CONTEXT_ARGS,
      ...(onProgress === undefined ? {} : { onProgress }),
      ...(signal === undefined ? {} : { signal }),
    });
    return dropLoops(dropMarkers(mergeTokens(toCaptions({ whisperCppOutput: output }).captions)));
  }
}
