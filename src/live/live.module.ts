import { Module } from '@nestjs/common';
import { DownloadModule } from '../download/download.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { PublishModule } from '../publish/publish.module.js';
import { RenderModule } from '../render/render.module.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { ClipFactory } from './clip-factory.js';
import { LiveRecorder } from './live-recorder.js';
import { LiveService } from './live.service.js';

@Module({
  imports: [DownloadModule, TranscriptionModule, RenderModule, PublishModule, LlmModule],
  providers: [LiveRecorder, ClipFactory, LiveService],
  exports: [LiveService],
})
export class LiveModule {}
