-- AlterEnum
ALTER TYPE "ReportStatus" ADD VALUE 'withdrawn';

-- AlterTable
ALTER TABLE "ContentCreationDraft" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "subjectAccountId" TEXT,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ContentCreationDraft_expiresAt_idx" ON "ContentCreationDraft"("expiresAt");

-- CreateIndex
CREATE INDEX "Report_subjectAccountId_idx" ON "Report"("subjectAccountId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_subjectAccountId_fkey" FOREIGN KEY ("subjectAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
