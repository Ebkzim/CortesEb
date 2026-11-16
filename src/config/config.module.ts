import { Global, Module } from '@nestjs/common';
import { AppPaths } from './app-paths.js';
import { Secrets } from './secrets.js';
import { UserConfigStore } from './user-config.js';

@Global()
@Module({
  providers: [AppPaths, Secrets, UserConfigStore],
  exports: [AppPaths, Secrets, UserConfigStore],
})
export class ConfigModule {}
