import { Module } from '@nestjs/common';
import { SfxGenerator } from './sfx-generator.js';
import { SfxLibrary } from './sfx-library.js';

@Module({
  providers: [SfxLibrary, SfxGenerator],
  exports: [SfxLibrary, SfxGenerator],
})
export class SfxModule {}
