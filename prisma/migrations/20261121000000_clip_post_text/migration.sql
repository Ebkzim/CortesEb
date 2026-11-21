ALTER TABLE "clips" ADD COLUMN "description" TEXT;
ALTER TABLE "clips" ADD COLUMN "hashtags" JSONB NOT NULL DEFAULT '[]';
