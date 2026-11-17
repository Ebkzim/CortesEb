import { Module } from '@nestjs/common';
import { LayoutService } from './layout.service.js';

@Module({
  providers: [LayoutService],
  exports: [LayoutService],
})
export class LayoutModule {}
