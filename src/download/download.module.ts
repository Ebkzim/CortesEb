import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { VideoFetcher } from './video-fetcher.js';

@Module({
  imports: [MediaModule],
  providers: [VideoFetcher],
  exports: [VideoFetcher],
})
export class DownloadModule {}
