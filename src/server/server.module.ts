import { type DynamicModule, Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { CommonModule } from '../common/common.module.js';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { PublishModule } from '../publish/publish.module.js';
import { BrowserModule } from '../browser/browser.module.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { FilesController } from './files.controller.js';
import { JobsController } from './jobs.controller.js';
import { LibraryController } from './library.controller.js';
import { PublishController } from './publish.controller.js';
import { DeskController } from './desk.controller.js';
import { SESSION_GATE, SessionController } from './session.controller.js';
import type { SessionGate } from './session.js';
import { SettingsController } from './settings.controller.js';

@Module({})
export class ServerModule {
  static register(gate: SessionGate): DynamicModule {
    return {
      module: ServerModule,
      imports: [
        CommonModule,
        ConfigModule,
        DatabaseModule,
        JobsModule,
        LlmModule,
        AccountsModule,
        TranscriptionModule,
        PublishModule,
        BrowserModule,
      ],
      controllers: [
        SessionController,
        JobsController,
        LibraryController,
        SettingsController,
        FilesController,
        PublishController,
        DeskController,
      ],
      providers: [{ provide: SESSION_GATE, useValue: gate }],
    };
  }
}
