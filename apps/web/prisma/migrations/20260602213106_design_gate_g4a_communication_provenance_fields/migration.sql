-- AlterTable
ALTER TABLE "Bulletin" ADD COLUMN     "archiveProposalId" TEXT,
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedByAccountId" TEXT;

-- AlterTable
ALTER TABLE "LivingDocument" ADD COLUMN     "archiveProposalId" TEXT,
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedByAccountId" TEXT;

-- AlterTable
ALTER TABLE "LivingDocumentRevision" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByAccountId" TEXT,
ADD COLUMN     "proposalId" TEXT;

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "archiveProposalId" TEXT,
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedByAccountId" TEXT;

-- AlterTable
ALTER TABLE "PublicationEntry" ADD COLUMN     "archiveProposalId" TEXT,
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedByAccountId" TEXT;
