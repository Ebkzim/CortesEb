import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { TargetsService } from './targets.service.js';

@Module({
  imports: [MediaModule],
  providers: [TargetsService],
  exports: [TargetsService],
})
export class PlanningModule {}
