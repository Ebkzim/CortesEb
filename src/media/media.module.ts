import { Module } from '@nestjs/common';
import { MediaTools } from './media-tools.js';

@Module({
  providers: [MediaTools],
  exports: [MediaTools],
})
export class MediaModule {}
