import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { VideoFetcher } from './video-fetcher.js';
import { YtDlp } from './yt-dlp.js';

@Module({
  imports: [MediaModule],
  providers: [VideoFetcher, YtDlp],
  exports: [VideoFetcher, YtDlp],
})
export class DownloadModule {}
