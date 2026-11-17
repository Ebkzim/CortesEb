import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { PublishWorker } from './publish-worker.js';
import { QueueService } from './queue.service.js';
import { QueueStore } from './queue-store.js';

@Module({
  imports: [AccountsModule],
  providers: [QueueStore, QueueService, OutboxPublisher, PublishWorker],
  exports: [QueueStore, QueueService, PublishWorker],
})
export class PublishModule {}
