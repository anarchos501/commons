-- CreateEnum
CREATE TYPE "ConcernFindingOutcome" AS ENUM ('substantiated', 'partially_substantiated', 'unsubstantiated', 'insufficient_information', 'withdrawn');

-- CreateEnum
CREATE TYPE "ConcernClosureReason" AS ENUM ('reporter_withdrawal', 'review_complete_no_action', 'action_accepted_and_implemented', 'action_rejected_no_further_proposal', 'administrative_closure');

-- CreateEnum
CREATE TYPE "ConcernProposalStatus" AS ENUM ('pending', 'accepted', 'rejected', 'superseded');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReportStatus" ADD VALUE 'findings_issued';
ALTER TYPE "ReportStatus" ADD VALUE 'action_proposed';
ALTER TYPE "ReportStatus" ADD VALUE 'closed';

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closureReason" "ConcernClosureReason";

-- CreateTable
CREATE TABLE "ConcernReview" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ConcernReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConcernFinding" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "outcome" "ConcernFindingOutcome" NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConcernFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConcernActionProposal" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "proposedAction" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "status" "ConcernProposalStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConcernActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConcernReview_reportId_idx" ON "ConcernReview"("reportId");

-- CreateIndex
CREATE INDEX "ConcernReview_reviewerId_idx" ON "ConcernReview"("reviewerId");

-- CreateIndex
CREATE INDEX "ConcernReview_groupId_idx" ON "ConcernReview"("groupId");

-- CreateIndex
CREATE INDEX "ConcernFinding_reportId_idx" ON "ConcernFinding"("reportId");

-- CreateIndex
CREATE INDEX "ConcernFinding_reviewerId_idx" ON "ConcernFinding"("reviewerId");

-- CreateIndex
CREATE INDEX "ConcernActionProposal_reportId_idx" ON "ConcernActionProposal"("reportId");

-- CreateIndex
CREATE INDEX "ConcernActionProposal_proposedById_idx" ON "ConcernActionProposal"("proposedById");

-- AddForeignKey
ALTER TABLE "ConcernReview" ADD CONSTRAINT "ConcernReview_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernReview" ADD CONSTRAINT "ConcernReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernReview" ADD CONSTRAINT "ConcernReview_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernFinding" ADD CONSTRAINT "ConcernFinding_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernFinding" ADD CONSTRAINT "ConcernFinding_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernFinding" ADD CONSTRAINT "ConcernFinding_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernActionProposal" ADD CONSTRAINT "ConcernActionProposal_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernActionProposal" ADD CONSTRAINT "ConcernActionProposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernActionProposal" ADD CONSTRAINT "ConcernActionProposal_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
