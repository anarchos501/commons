-- AlterTable
ALTER TABLE "Petition" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Responsibility" ADD COLUMN     "descriptionDocumentId" TEXT;

-- CreateTable
CREATE TABLE "ResponsibilityProposalDraft" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "abilities" JSONB NOT NULL,
    "proposedByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "appliedResponsibilityId" TEXT,

    CONSTRAINT "ResponsibilityProposalDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResponsibilityProposalDraft_groupId_idx" ON "ResponsibilityProposalDraft"("groupId");

-- CreateIndex
CREATE INDEX "ResponsibilityProposalDraft_proposedByMembershipId_idx" ON "ResponsibilityProposalDraft"("proposedByMembershipId");

-- CreateIndex
CREATE INDEX "Petition_groupId_archivedAt_idx" ON "Petition"("groupId", "archivedAt");

-- AddForeignKey
ALTER TABLE "ResponsibilityProposalDraft" ADD CONSTRAINT "ResponsibilityProposalDraft_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityProposalDraft" ADD CONSTRAINT "ResponsibilityProposalDraft_proposedByMembershipId_fkey" FOREIGN KEY ("proposedByMembershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
