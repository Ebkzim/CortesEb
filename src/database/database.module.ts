import { Module } from '@nestjs/common';
import { ApiKeyRepository } from './api-key.repository.js';
import { JobRepository } from './job.repository.js';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService, JobRepository, ApiKeyRepository],
  exports: [PrismaService, JobRepository, ApiKeyRepository],
})
export class DatabaseModule {}
