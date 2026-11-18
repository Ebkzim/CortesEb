import path from 'node:path';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { AppError } from '../common/app-error.js';
import { AppPaths } from '../config/app-paths.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { migrate, status, type MigrationReport } from './migrator.js';

const BUSY_TIMEOUT_MS = 10_000;

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private client: PrismaClient | null = null;

  constructor(private readonly paths: AppPaths) {}

  get file(): string {
    return this.paths.databaseFile;
  }

  get migrationsDir(): string {
    return path.join(this.paths.packageRoot, 'prisma', 'migrations');
  }

  get db(): PrismaClient {
    if (this.client === null) {
      try {
        migrate(this.file, this.migrationsDir);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'erro desconhecido';
        throw new AppError(
          'NOT_CONFIGURED',
          `não consegui preparar o banco ${this.file}: ${reason}`,
        );
      }
      this.client = new PrismaClient({
        adapter: new PrismaBetterSqlite3({ url: `file:${this.file}`, timeout: BUSY_TIMEOUT_MS }),
      });
    }
    return this.client;
  }

  migrate(): MigrationReport {
    return migrate(this.file, this.migrationsDir);
  }

  status(): MigrationReport {
    return status(this.file, this.migrationsDir);
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.$queryRaw`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
