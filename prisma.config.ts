import { config as loadEnvironment } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadEnvironment({ path: '.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
});
