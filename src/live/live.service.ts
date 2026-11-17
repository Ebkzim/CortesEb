import { Injectable } from '@nestjs/common';
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

  run(request: LiveRequest, signal: AbortSignal): Promise<LiveSummary> {
    const channel = request.chat ? twitchChannel(request.link) : null;
    const session = new LiveSession(
      request,
      {
        recorder: this.recorder,
        factory: this.factory,
        output: this.output,
        chat: channel === null ? null : new TwitchChat(channel),
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
