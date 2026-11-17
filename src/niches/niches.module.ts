import { Module } from '@nestjs/common';
import { NicheRegistry } from './niche-registry.js';

@Module({
  providers: [NicheRegistry],
  exports: [NicheRegistry],
})
export class NichesModule {}
