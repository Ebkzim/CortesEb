import { Global, Module } from '@nestjs/common';
import { Output } from './output.js';
import { ProcessRunner } from './process-runner.js';

@Global()
@Module({
  providers: [ProcessRunner, Output],
  exports: [ProcessRunner, Output],
})
export class CommonModule {}
