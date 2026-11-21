import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { BrowserModule } from '../browser/browser.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { BrowserTools } from './browser-tools.js';
import { CredentialVault } from './credential-vault.js';
import { LibraryPostText } from './post-text.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { PublishService } from './publish-service.js';
import { PublishWorker } from './publish-worker.js';
import { QueueService } from './queue.service.js';
import { QueueStore } from './queue-store.js';

@Module({
  imports: [AccountsModule, DatabaseModule, BrowserModule],
  providers: [
    BrowserTools,
    PublishService,
    LibraryPostText,
    QueueStore,
    QueueService,
    OutboxPublisher,
    PublishWorker,
    CredentialVault,
  ],
  exports: [PublishService, QueueStore, QueueService, PublishWorker, CredentialVault],
})
export class PublishModule {}
