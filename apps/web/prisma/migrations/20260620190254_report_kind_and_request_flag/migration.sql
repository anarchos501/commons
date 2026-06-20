-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('person_concern', 'request_flag');

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "kind" "ReportKind" NOT NULL DEFAULT 'person_concern',
ADD COLUMN     "supportRequestId" TEXT;

-- CreateIndex
CREATE INDEX "Report_supportRequestId_idx" ON "Report"("supportRequestId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_supportRequestId_fkey" FOREIGN KEY ("supportRequestId") REFERENCES "SupportRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
