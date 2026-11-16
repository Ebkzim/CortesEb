import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { TranscriptionService } from './transcription.service.js';
import { Whisper } from './whisper.js';

@Module({
  imports: [MediaModule],
  providers: [Whisper, TranscriptionService],
  exports: [Whisper, TranscriptionService],
})
export class TranscriptionModule {}
