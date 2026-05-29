-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('open', 'under_review', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reportedByAccountId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "context" TEXT,
    "description" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_reportedByAccountId_idx" ON "Report"("reportedByAccountId");

-- CreateIndex
CREATE INDEX "Report_groupId_idx" ON "Report"("groupId");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedByAccountId_fkey" FOREIGN KEY ("reportedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
