import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { ConfigModule } from '../config/config.module.js';
import { DoctorService } from '../doctor/doctor.service.js';
import { DownloadModule } from '../download/download.module.js';
import { ImagesModule } from '../images/images.module.js';
import { MediaModule } from '../media/media.module.js';
import { NicheRegistry } from '../niches/niche-registry.js';
import { RenderModule } from '../render/render.module.js';
import { SfxModule } from '../sfx/sfx.module.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { ConfigCommand, NichesCommand, ProfileCommand } from './commands/config.command.js';
import { DoctorCommand, SetupCommand } from './commands/doctor.command.js';
import {
  FetchCommand,
  FrameCommand,
  RenderCommand,
  SfxCommand,
  TranscribeCommand,
  TranscriptCommand,
} from './commands/pipeline.command.js';

@Module({
  imports: [
    CommonModule,
    ConfigModule,
    MediaModule,
    DownloadModule,
    TranscriptionModule,
    ImagesModule,
    SfxModule,
    RenderModule,
  ],
  providers: [
    DoctorService,
    NicheRegistry,
    DoctorCommand,
    SetupCommand,
    ProfileCommand,
    ConfigCommand,
    NichesCommand,
    FetchCommand,
    TranscribeCommand,
    TranscriptCommand,
    FrameCommand,
    RenderCommand,
    SfxCommand,
  ],
})
export class CliModule {}
