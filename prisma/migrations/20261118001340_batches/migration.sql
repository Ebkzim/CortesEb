-- AlterTable
ALTER TABLE "cortes_eb"."jobs" ADD COLUMN     "batch_id" UUID;

-- CreateTable
CREATE TABLE "cortes_eb"."batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(200) NOT NULL,
    "preset" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batches_created_at_idx" ON "cortes_eb"."batches"("created_at");

-- CreateIndex
CREATE INDEX "jobs_batch_id_idx" ON "cortes_eb"."jobs"("batch_id");

-- AddForeignKey
ALTER TABLE "cortes_eb"."jobs" ADD CONSTRAINT "jobs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "cortes_eb"."batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
