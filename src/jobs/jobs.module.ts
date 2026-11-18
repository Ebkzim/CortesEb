import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { DownloadModule } from '../download/download.module.js';
import { LayoutModule } from '../layout/layout.module.js';
import { LiveModule } from '../live/live.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { MediaModule } from '../media/media.module.js';
import { NichesModule } from '../niches/niches.module.js';
import { PlanningModule } from '../planning/planning.module.js';
import { RenderModule } from '../render/render.module.js';
import { SelectModule } from '../select/select.module.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { CameraMemory } from './camera-memory.js';
import { CutPipeline } from './cut-pipeline.js';
import { JobEvents } from './job-events.js';
import { JobRunner } from './job-runner.js';
import { LibraryService } from './library.service.js';
import { LivePipeline } from './live-pipeline.js';
import { SelectorClients } from './selector-client.js';
import { SpeedBook } from './speed-book.js';
import { StageGates } from './stage-gates.js';

@Module({
  imports: [
    DatabaseModule,
    DownloadModule,
    LayoutModule,
    LiveModule,
    LlmModule,
    MediaModule,
    NichesModule,
    PlanningModule,
    RenderModule,
    SelectModule,
    TranscriptionModule,
  ],
  providers: [
    JobEvents,
    JobRunner,
    LibraryService,
    CutPipeline,
    LivePipeline,
    SelectorClients,
    SpeedBook,
    StageGates,
    CameraMemory,
  ],
  exports: [JobEvents, JobRunner, LibraryService],
})
export class JobsModule {}
