import { Global, Module } from '@nestjs/common';
import { Output } from './output.js';
import { ProcessRunner } from './process-runner.js';
import { Progress } from './progress.js';

@Global()
@Module({
  providers: [ProcessRunner, Output, Progress],
  exports: [ProcessRunner, Output, Progress],
})
export class CommonModule {}
