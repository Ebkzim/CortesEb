import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { CommonModule } from '../common/common.module.js';
import { ConfigModule } from '../config/config.module.js';
import { DoctorService } from '../doctor/doctor.service.js';
import { DownloadModule } from '../download/download.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { SelectModule } from '../select/select.module.js';
import { PublishModule } from '../publish/publish.module.js';
import { LayoutModule } from '../layout/layout.module.js';
import { LiveModule } from '../live/live.module.js';
import { ImagesModule } from '../images/images.module.js';
import { MediaModule } from '../media/media.module.js';
import { NichesModule } from '../niches/niches.module.js';
import { PlanningModule } from '../planning/planning.module.js';
import { RenderModule } from '../render/render.module.js';
import { SfxModule } from '../sfx/sfx.module.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { AccountCommand, ConfigCommand, NichesCommand } from './commands/config.command.js';
import { DoctorCommand, SetupCommand } from './commands/doctor.command.js';
import { CredentialsCommand } from './commands/credentials.command.js';
import { DbCommand } from './commands/db.command.js';
import { LayoutCommand } from './commands/layout.command.js';
import { LlmCommand } from './commands/llm.command.js';
import { SelectCommand } from './commands/select.command.js';
import { QueueCommand } from './commands/queue.command.js';
import { LiveCommand, LiveFrameCommand } from './commands/live.command.js';
import {
  CaptionsCommand,
  CheckCommand,
  FetchCommand,
  FrameCommand,
  PeaksCommand,
  PlanCommand,
  RefineCommand,
  RenderCommand,
  SfxCommand,
  TranscribeCommand,
  TranscriptCommand,
} from './commands/pipeline.command.js';

@Module({
  imports: [
    NichesModule,
    AccountsModule,
    AnalysisModule,
    CommonModule,
    ConfigModule,
    MediaModule,
    DownloadModule,
    TranscriptionModule,
    ImagesModule,
    SfxModule,
    RenderModule,
    PlanningModule,
    LiveModule,
    PublishModule,
    LlmModule,
    SelectModule,
    LayoutModule,
  ],
  providers: [
    DoctorService,
    DoctorCommand,
    SetupCommand,
    AccountCommand,
    ConfigCommand,
    NichesCommand,
    FetchCommand,
    PlanCommand,
    PeaksCommand,
    CheckCommand,
    CaptionsCommand,
    RefineCommand,
    TranscribeCommand,
    TranscriptCommand,
    FrameCommand,
    RenderCommand,
    SfxCommand,
    LiveCommand,
    LiveFrameCommand,
    QueueCommand,
    CredentialsCommand,
    LlmCommand,
    SelectCommand,
    LayoutCommand,
    DbCommand,
  ],
})
export class CliModule {}
