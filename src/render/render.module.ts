import { Module } from '@nestjs/common';
import { ImagesModule } from '../images/images.module.js';
import { MediaModule } from '../media/media.module.js';
import { SfxModule } from '../sfx/sfx.module.js';
import { ClipComposer } from './clip-composer.js';
import { RemotionEngine } from './remotion-engine.js';
import { RenderService } from './render.service.js';

@Module({
  imports: [MediaModule, ImagesModule, SfxModule],
  providers: [ClipComposer, RemotionEngine, RenderService],
  exports: [RenderService, RemotionEngine],
})
export class RenderModule {}
