import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { PlanningModule } from '../planning/planning.module.js';
import { SelectorService } from './selector.service.js';

@Module({
  imports: [LlmModule, PlanningModule],
  providers: [SelectorService],
  exports: [SelectorService],
})
export class SelectModule {}
