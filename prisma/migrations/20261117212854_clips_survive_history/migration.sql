-- DropForeignKey
ALTER TABLE "cortes_eb"."clips" DROP CONSTRAINT "clips_job_id_fkey";

-- AlterTable
ALTER TABLE "cortes_eb"."clips" ALTER COLUMN "job_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "cortes_eb"."clips" ADD CONSTRAINT "clips_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "cortes_eb"."jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
