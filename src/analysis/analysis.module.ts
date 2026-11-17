import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { PeaksService } from './peaks.service.js';

@Module({
  imports: [MediaModule],
  providers: [PeaksService],
  exports: [PeaksService],
})
export class AnalysisModule {}
