import { Module } from '@nestjs/common';
import { DownloadModule } from '../download/download.module.js';
import { RenderModule } from '../render/render.module.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { ClipFactory } from './clip-factory.js';
import { LiveRecorder } from './live-recorder.js';
import { LiveService } from './live.service.js';

@Module({
  imports: [DownloadModule, TranscriptionModule, RenderModule],
  providers: [LiveRecorder, ClipFactory, LiveService],
  exports: [LiveService],
})
export class LiveModule {}
