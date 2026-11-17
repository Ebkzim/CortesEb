import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { Output } from '../common/output.js';
import { VideoFetcher } from '../download/video-fetcher.js';
import { Workspace } from '../workspace/workspace.js';
import { ClipFactory } from './clip-factory.js';
import { LiveRecorder } from './live-recorder.js';
import { TwitchChat, twitchChannel } from './twitch-chat.js';
import { LiveSession, type LiveRequest, type LiveSummary } from './live-session.js';

@Injectable()
export class LiveService {
  constructor(
    private readonly recorder: LiveRecorder,
    private readonly factory: ClipFactory,
    private readonly fetcher: VideoFetcher,
    private readonly output: Output,
  ) {}

  async snapshot(link: string, output: string, maxHeight: number): Promise<string> {
    const stream = await this.recorder.resolve(link, maxHeight);
    if (!stream.live) throw new AppError('INVALID_INPUT', 'esse link não está ao vivo agora');
    await this.recorder.snapshot(stream.url, output);
    return path.resolve(output);
  }

  run(request: LiveRequest, signal: AbortSignal): Promise<LiveSummary> {
    const channel = request.chat ? twitchChannel(request.link) : null;
    const session = new LiveSession(
      request,
      {
        recorder: this.recorder,
        factory: this.factory,
        output: this.output,
        chat: channel === null ? null : new TwitchChat(channel),
        watchAds: twitchChannel(request.link) !== null,
        fetchBottom: async (source, workRoot) => {
          this.output.info('> preparando o vídeo de baixo');
          return this.fetcher.fetch(source, 'bottom', new Workspace(workRoot));
        },
      },
      signal,
    );
    return session.run();
  }
}
