import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppError } from '../common/app-error.js';
import { PrismaClient } from '../generated/prisma/client.js';

const POOL_SIZE = 5;

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private client: PrismaClient | null = null;

  get db(): PrismaClient {
    if (this.client === null) {
      const connectionString = process.env.DATABASE_URL?.trim();
      if (connectionString === undefined || connectionString === '') {
        throw new AppError(
          'NOT_CONFIGURED',
          'defina DATABASE_URL (no arquivo .env da pasta de dados do cortes-eb)',
        );
      }
      this.client = new PrismaClient({
        adapter: new PrismaPg({ connectionString, max: POOL_SIZE }),
      });
    }
    return this.client;
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
