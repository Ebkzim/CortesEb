import { Module } from '@nestjs/common';
import { QueueStore } from './queue-store.js';

@Module({
  providers: [QueueStore],
  exports: [QueueStore],
})
export class PublishModule {}
