import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { BrowserModule } from '../browser/browser.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { PublishModule } from '../publish/publish.module.js';
import { WarmingDesk } from './warming-desk.js';
import { WarmingDeskController } from './warming-desk.controller.js';
import { WarmingBrowser } from './warming-browser.js';
import { WarmingController } from './warming.controller.js';
import { WarmingStore } from './warming-store.js';
import { WarmingService } from './warming.service.js';

@Module({
  imports: [AccountsModule, BrowserModule, LlmModule, PublishModule, DatabaseModule],
  controllers: [WarmingController, WarmingDeskController],
  providers: [WarmingStore, WarmingBrowser, WarmingService, WarmingDesk],
})
export class WarmingModule {}
