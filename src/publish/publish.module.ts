import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { QueueService } from './queue.service.js';
import { QueueStore } from './queue-store.js';

@Module({
  imports: [AccountsModule],
  providers: [QueueStore, QueueService],
  exports: [QueueStore, QueueService],
})
export class PublishModule {}
