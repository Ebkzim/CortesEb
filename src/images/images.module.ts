import { Module } from '@nestjs/common';
import { ImageFetcher } from './image-fetcher.js';
import { ImageResolver } from './image-resolver.js';
import { ImageSearch } from './image-search.js';

@Module({
  providers: [ImageFetcher, ImageSearch, ImageResolver],
  exports: [ImageResolver, ImageSearch, ImageFetcher],
})
export class ImagesModule {}
