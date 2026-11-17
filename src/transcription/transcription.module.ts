import { Module } from '@nestjs/common';
import { DownloadModule } from '../download/download.module.js';
import { MediaModule } from '../media/media.module.js';
import { TranscriptionService } from './transcription.service.js';
import { Whisper } from './whisper.js';
import { YoutubeCaptions } from './youtube-captions.js';

@Module({
  imports: [MediaModule, DownloadModule],
  providers: [Whisper, YoutubeCaptions, TranscriptionService],
  exports: [Whisper, TranscriptionService],
})
export class TranscriptionModule {}
