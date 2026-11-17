import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { CommonModule } from '../common/common.module.js';
import { ConfigModule } from '../config/config.module.js';
import { DoctorService } from '../doctor/doctor.service.js';
import { DownloadModule } from '../download/download.module.js';
import { ImagesModule } from '../images/images.module.js';
import { MediaModule } from '../media/media.module.js';
import { NicheRegistry } from '../niches/niche-registry.js';
import { PlanningModule } from '../planning/planning.module.js';
import { RenderModule } from '../render/render.module.js';
import { SfxModule } from '../sfx/sfx.module.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { AccountCommand, ConfigCommand, NichesCommand } from './commands/config.command.js';
import { DoctorCommand, SetupCommand } from './commands/doctor.command.js';
import {
  CaptionsCommand,
  CheckCommand,
  FetchCommand,
  FrameCommand,
  PlanCommand,
  RefineCommand,
  RenderCommand,
  SfxCommand,
  TranscribeCommand,
  TranscriptCommand,
} from './commands/pipeline.command.js';

@Module({
  imports: [
    AccountsModule,
    CommonModule,
    ConfigModule,
    MediaModule,
    DownloadModule,
    TranscriptionModule,
    ImagesModule,
    SfxModule,
    RenderModule,
    PlanningModule,
  ],
  providers: [
    DoctorService,
    NicheRegistry,
    DoctorCommand,
    SetupCommand,
    AccountCommand,
    ConfigCommand,
    NichesCommand,
    FetchCommand,
    PlanCommand,
    CheckCommand,
    CaptionsCommand,
    RefineCommand,
    TranscribeCommand,
    TranscriptCommand,
    FrameCommand,
    RenderCommand,
    SfxCommand,
  ],
})
export class CliModule {}
