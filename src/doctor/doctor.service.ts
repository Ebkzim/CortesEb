import { Injectable } from '@nestjs/common';
import { exists } from '../common/json-file.js';
import { ProcessRunner } from '../common/process-runner.js';
import { AppPaths } from '../config/app-paths.js';
import { Secrets } from '../config/secrets.js';
import { UserConfigStore } from '../config/user-config.js';
import { ImageSearch } from '../images/image-search.js';
import { SfxLibrary } from '../sfx/sfx-library.js';
import { Whisper } from '../transcription/whisper.js';

export interface DoctorReport {
  ready: boolean;
  node: string;
  nodeOk: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  ytdlp: boolean;
  whisper: boolean;
  whisperModel: string;
  language: string;
  profile: boolean;
  profileName: string | null;
  niche: string;
  sfx: number;
  elevenlabsKey: boolean;
  googleImages: boolean;
  home: string;
}

const MIN_NODE_MAJOR = 22;

@Injectable()
export class DoctorService {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly paths: AppPaths,
    private readonly config: UserConfigStore,
    private readonly secrets: Secrets,
    private readonly whisper: Whisper,
    private readonly sfx: SfxLibrary,
    private readonly imageSearch: ImageSearch,
  ) {}

  async report(): Promise<DoctorReport> {
    const config = await this.config.load();
    const [ffmpeg, ffprobe, ytdlp, whisper, sfx] = await Promise.all([
      this.runner.has('ffmpeg'),
      this.runner.has('ffprobe'),
      this.runner.has('yt-dlp'),
      this.whisper.isReady(config.whisperModel),
      this.sfx.count(),
    ]);
    const nodeOk = Number(process.versions.node.split('.')[0]) >= MIN_NODE_MAJOR;
    const profile =
      config.profileName !== undefined &&
      config.logo !== undefined &&
      (await exists(this.paths.inHome(config.logo)));
    return {
      ready: nodeOk && ffmpeg && ffprobe && whisper,
      node: process.versions.node,
      nodeOk,
      ffmpeg,
      ffprobe,
      ytdlp,
      whisper,
      whisperModel: config.whisperModel,
      language: config.language,
      profile,
      profileName: config.profileName ?? null,
      niche: config.niche,
      sfx,
      elevenlabsKey: this.secrets.has('ELEVENLABS_API_KEY'),
      googleImages: this.imageSearch.isConfigured(),
      home: this.paths.home,
    };
  }
}
