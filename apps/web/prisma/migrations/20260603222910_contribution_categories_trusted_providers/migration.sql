-- CreateEnum
CREATE TYPE "OfferingEntityType" AS ENUM ('group', 'project', 'responsibility');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "TrustedProviderStatusValue" AS ENUM ('active', 'revoked');

-- AlterEnum
ALTER TYPE "CoordinationAbility" ADD VALUE 'create_contribution_categories';

-- AlterTable
ALTER TABLE "Petition" ADD COLUMN     "voterScope" JSONB;

-- AlterTable
ALTER TABLE "ServiceCapability" ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "SupportRequestService" ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "RequestRoute" ALTER COLUMN "serviceCapabilityId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ContributionCategoryDraft" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "offeringEntityType" "OfferingEntityType" NOT NULL,
    "offeringEntityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "proposedByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributionCategoryDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionCategory" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "offeringEntityType" "OfferingEntityType" NOT NULL,
    "offeringEntityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CategoryStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ContributionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedProviderApplication" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "categoryIds" JSONB NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedProviderApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedProviderRevocationRequest" (
    "id" TEXT NOT NULL,
    "targetMembershipId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "statusIds" JSONB NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedProviderRevocationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedProviderStatus" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "status" "TrustedProviderStatusValue" NOT NULL DEFAULT 'active',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TrustedProviderStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContributionCategoryDraft_groupId_idx" ON "ContributionCategoryDraft"("groupId");

-- CreateIndex
CREATE INDEX "ContributionCategoryDraft_proposedByMembershipId_idx" ON "ContributionCategoryDraft"("proposedByMembershipId");

-- CreateIndex
CREATE INDEX "ContributionCategory_groupId_idx" ON "ContributionCategory"("groupId");

-- CreateIndex
CREATE INDEX "ContributionCategory_offeringEntityType_offeringEntityId_idx" ON "ContributionCategory"("offeringEntityType", "offeringEntityId");

-- CreateIndex
CREATE INDEX "ContributionCategory_status_idx" ON "ContributionCategory"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionCategory_offeringEntityType_offeringEntityId_na_key" ON "ContributionCategory"("offeringEntityType", "offeringEntityId", "name");

-- CreateIndex
CREATE INDEX "TrustedProviderApplication_membershipId_idx" ON "TrustedProviderApplication"("membershipId");

-- CreateIndex
CREATE INDEX "TrustedProviderApplication_groupId_idx" ON "TrustedProviderApplication"("groupId");

-- CreateIndex
CREATE INDEX "TrustedProviderRevocationRequest_targetMembershipId_idx" ON "TrustedProviderRevocationRequest"("targetMembershipId");

-- CreateIndex
CREATE INDEX "TrustedProviderRevocationRequest_groupId_idx" ON "TrustedProviderRevocationRequest"("groupId");

-- CreateIndex
CREATE INDEX "TrustedProviderStatus_membershipId_idx" ON "TrustedProviderStatus"("membershipId");

-- CreateIndex
CREATE INDEX "TrustedProviderStatus_categoryId_idx" ON "TrustedProviderStatus"("categoryId");

-- CreateIndex
CREATE INDEX "TrustedProviderStatus_groupId_idx" ON "TrustedProviderStatus"("groupId");

-- CreateIndex
CREATE INDEX "TrustedProviderStatus_status_idx" ON "TrustedProviderStatus"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedProviderStatus_membershipId_categoryId_key" ON "TrustedProviderStatus"("membershipId", "categoryId");

-- CreateIndex
CREATE INDEX "ServiceCapability_categoryId_idx" ON "ServiceCapability"("categoryId");

-- CreateIndex
CREATE INDEX "SupportRequestService_categoryId_idx" ON "SupportRequestService"("categoryId");

-- AddForeignKey
ALTER TABLE "ServiceCapability" ADD CONSTRAINT "ServiceCapability_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ContributionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequestService" ADD CONSTRAINT "SupportRequestService_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ContributionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionCategoryDraft" ADD CONSTRAINT "ContributionCategoryDraft_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionCategoryDraft" ADD CONSTRAINT "ContributionCategoryDraft_proposedByMembershipId_fkey" FOREIGN KEY ("proposedByMembershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionCategory" ADD CONSTRAINT "ContributionCategory_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedProviderApplication" ADD CONSTRAINT "TrustedProviderApplication_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedProviderApplication" ADD CONSTRAINT "TrustedProviderApplication_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedProviderRevocationRequest" ADD CONSTRAINT "TrustedProviderRevocationRequest_targetMembershipId_fkey" FOREIGN KEY ("targetMembershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedProviderRevocationRequest" ADD CONSTRAINT "TrustedProviderRevocationRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedProviderStatus" ADD CONSTRAINT "TrustedProviderStatus_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedProviderStatus" ADD CONSTRAINT "TrustedProviderStatus_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ContributionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedProviderStatus" ADD CONSTRAINT "TrustedProviderStatus_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
