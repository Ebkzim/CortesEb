import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { ImagesModule } from '../images/images.module.js';
import { LayoutModule } from '../layout/layout.module.js';
import { MediaModule } from '../media/media.module.js';
import { PlanningModule } from '../planning/planning.module.js';
import { SfxModule } from '../sfx/sfx.module.js';
import { ClipComposer } from './clip-composer.js';
import { FfmpegEngine } from './ffmpeg/ffmpeg-engine.js';
import { RemotionEngine } from './remotion-engine.js';
import { RenderService } from './render.service.js';

@Module({
  imports: [LayoutModule, MediaModule, ImagesModule, SfxModule, AccountsModule, PlanningModule],
  providers: [ClipComposer, FfmpegEngine, RemotionEngine, RenderService],
  exports: [RenderService, RemotionEngine],
})
export class RenderModule {}
