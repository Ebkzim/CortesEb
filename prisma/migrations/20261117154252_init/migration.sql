-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "cortes_eb";

-- CreateTable
CREATE TABLE "cortes_eb"."jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "preset" VARCHAR(40) NOT NULL,
    "request" JSONB NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "waiting" JSONB,
    "summary" JSONB,
    "error" VARCHAR(1000),
    "work_dir" VARCHAR(1024) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cortes_eb"."job_logs" (
    "id" BIGSERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "level" VARCHAR(8) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cortes_eb"."clips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "day" CHAR(10) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "hook" VARCHAR(500),
    "score" INTEGER,
    "seconds" DOUBLE PRECISION NOT NULL,
    "file" VARCHAR(1024) NOT NULL,
    "thumb" VARCHAR(1024),
    "size_bytes" BIGINT NOT NULL,
    "account" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cortes_eb"."api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(16) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "base_url" VARCHAR(300),
    "model" VARCHAR(100),
    "secret" VARCHAR(4096) NOT NULL,
    "hint" VARCHAR(8) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_status_created_at_idx" ON "cortes_eb"."jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "job_logs_job_id_created_at_idx" ON "cortes_eb"."job_logs"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "clips_day_created_at_idx" ON "cortes_eb"."clips"("day", "created_at");

-- CreateIndex
CREATE INDEX "clips_job_id_idx" ON "cortes_eb"."clips"("job_id");

-- AddForeignKey
ALTER TABLE "cortes_eb"."job_logs" ADD CONSTRAINT "job_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "cortes_eb"."jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cortes_eb"."clips" ADD CONSTRAINT "clips_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "cortes_eb"."jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
