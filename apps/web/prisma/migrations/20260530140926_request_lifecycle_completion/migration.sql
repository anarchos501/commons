-- AlterEnum
ALTER TYPE "SupportRequestStatus" ADD VALUE 'routed';

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_reportedByAccountId_fkey";

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "guestAccessTokenId" TEXT,
ALTER COLUMN "reportedByAccountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SupportRequest" ADD COLUMN     "accountabilityEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GuestAccessToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "supportRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "GuestAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestAccessToken_tokenHash_key" ON "GuestAccessToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "GuestAccessToken_supportRequestId_key" ON "GuestAccessToken"("supportRequestId");

-- CreateIndex
CREATE INDEX "Report_guestAccessTokenId_idx" ON "Report"("guestAccessTokenId");

-- CreateIndex
CREATE INDEX "SupportRequest_accountabilityEndsAt_idx" ON "SupportRequest"("accountabilityEndsAt");

-- AddForeignKey
ALTER TABLE "GuestAccessToken" ADD CONSTRAINT "GuestAccessToken_supportRequestId_fkey" FOREIGN KEY ("supportRequestId") REFERENCES "SupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedByAccountId_fkey" FOREIGN KEY ("reportedByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_guestAccessTokenId_fkey" FOREIGN KEY ("guestAccessTokenId") REFERENCES "GuestAccessToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
