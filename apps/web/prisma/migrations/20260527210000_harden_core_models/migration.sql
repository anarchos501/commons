-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('guest', 'participant', 'member');

-- CreateEnum
CREATE TYPE "VisibilityLevel" AS ENUM ('private', 'group', 'project', 'public');

-- CreateEnum
CREATE TYPE "PrivacyLevel" AS ENUM ('private', 'group', 'project', 'public');

-- CreateEnum
CREATE TYPE "FederationPolicy" AS ENUM ('open', 'allowlisted', 'project_level', 'read_only', 'emergency_only', 'disabled');

-- CreateEnum
CREATE TYPE "PluginPolicy" AS ENUM ('open', 'allowlisted', 'reviewed', 'disabled');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'paused', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "TrustRequirement" AS ENUM ('lightweight', 'elevated');

-- CreateEnum
CREATE TYPE "ServiceCapabilityStatus" AS ENUM ('available', 'petitioned', 'approved', 'revoked', 'unavailable');

-- CreateEnum
CREATE TYPE "TrustStatus" AS ENUM ('petitioned', 'approved', 'objected', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "UrgencyLevel" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "SupportRequestStatus" AS ENUM ('open', 'matched', 'fulfilled', 'expired', 'deleted');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('open', 'accepted', 'declined', 'withdrawn', 'expired');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('draft', 'open', 'approved', 'rejected', 'withdrawn', 'implemented');

-- CreateEnum
CREATE TYPE "RoleRecallPolicy" AS ENUM ('proposal', 'consent', 'emergency');

-- CreateEnum
CREATE TYPE "GovernanceScope" AS ENUM ('node', 'group', 'project', 'proposal', 'service', 'plugin', 'contribution', 'account', 'trust');

-- CreateEnum
CREATE TYPE "GovernanceChangeRule" AS ENUM ('mutable', 'immutable', 'stricter_only', 'more_open_only');

-- CreateEnum
CREATE TYPE "LinkedPresenceStatus" AS ENUM ('active', 'migrating', 'inactive', 'revoked');

-- AlterTable: cast text fields to enums without dropping stored values.
ALTER TABLE "Account" ALTER COLUMN "accountType" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "accountType" TYPE "AccountType" USING "accountType"::"AccountType";
ALTER TABLE "Account" ALTER COLUMN "accountType" SET DEFAULT 'guest';
ALTER TABLE "Account" ALTER COLUMN "profileVisibility" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "profileVisibility" TYPE "VisibilityLevel" USING "profileVisibility"::"VisibilityLevel";
ALTER TABLE "Account" ALTER COLUMN "profileVisibility" SET DEFAULT 'private';

ALTER TABLE "Contribution" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "Contribution" ALTER COLUMN "visibility" TYPE "VisibilityLevel" USING "visibility"::"VisibilityLevel";
ALTER TABLE "Contribution" ALTER COLUMN "visibility" SET DEFAULT 'group';

ALTER TABLE "GovernancePreference" ALTER COLUMN "scope" TYPE "GovernanceScope" USING "scope"::"GovernanceScope";
ALTER TABLE "GovernancePreference" ALTER COLUMN "changeRule" DROP DEFAULT;
ALTER TABLE "GovernancePreference" ALTER COLUMN "changeRule" TYPE "GovernanceChangeRule" USING "changeRule"::"GovernanceChangeRule";
ALTER TABLE "GovernancePreference" ALTER COLUMN "changeRule" SET DEFAULT 'mutable';

ALTER TABLE "Node" ALTER COLUMN "federationPolicy" DROP DEFAULT;
ALTER TABLE "Node" ALTER COLUMN "federationPolicy" TYPE "FederationPolicy" USING "federationPolicy"::"FederationPolicy";
ALTER TABLE "Node" ALTER COLUMN "federationPolicy" SET DEFAULT 'disabled';
ALTER TABLE "Node" ALTER COLUMN "pluginPolicy" DROP DEFAULT;
ALTER TABLE "Node" ALTER COLUMN "pluginPolicy" TYPE "PluginPolicy" USING "pluginPolicy"::"PluginPolicy";
ALTER TABLE "Node" ALTER COLUMN "pluginPolicy" SET DEFAULT 'disabled';

ALTER TABLE "Offer" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Offer" ALTER COLUMN "status" TYPE "OfferStatus" USING "status"::"OfferStatus";
ALTER TABLE "Offer" ALTER COLUMN "status" SET DEFAULT 'open';
ALTER TABLE "Offer" ALTER COLUMN "privacyLevel" DROP DEFAULT;
ALTER TABLE "Offer" ALTER COLUMN "privacyLevel" TYPE "PrivacyLevel" USING "privacyLevel"::"PrivacyLevel";
ALTER TABLE "Offer" ALTER COLUMN "privacyLevel" SET DEFAULT 'group';

ALTER TABLE "PrivacyEnvelope" ALTER COLUMN "level" DROP DEFAULT;
ALTER TABLE "PrivacyEnvelope" ALTER COLUMN "level" TYPE "PrivacyLevel" USING "level"::"PrivacyLevel";
ALTER TABLE "PrivacyEnvelope" ALTER COLUMN "level" SET DEFAULT 'private';

ALTER TABLE "Project" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus" USING "status"::"ProjectStatus";
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'active';

ALTER TABLE "Proposal" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Proposal" ALTER COLUMN "status" TYPE "ProposalStatus" USING "status"::"ProposalStatus";
ALTER TABLE "Proposal" ALTER COLUMN "status" SET DEFAULT 'open';

ALTER TABLE "Role" ALTER COLUMN "recallPolicy" DROP DEFAULT;
ALTER TABLE "Role" ALTER COLUMN "recallPolicy" TYPE "RoleRecallPolicy" USING "recallPolicy"::"RoleRecallPolicy";
ALTER TABLE "Role" ALTER COLUMN "recallPolicy" SET DEFAULT 'proposal';

ALTER TABLE "ServiceCapability" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "ServiceCapability" ALTER COLUMN "visibility" TYPE "VisibilityLevel" USING "visibility"::"VisibilityLevel";
ALTER TABLE "ServiceCapability" ALTER COLUMN "visibility" SET DEFAULT 'group';
ALTER TABLE "ServiceCapability" ALTER COLUMN "trustRequirement" DROP DEFAULT;
ALTER TABLE "ServiceCapability" ALTER COLUMN "trustRequirement" TYPE "TrustRequirement" USING "trustRequirement"::"TrustRequirement";
ALTER TABLE "ServiceCapability" ALTER COLUMN "trustRequirement" SET DEFAULT 'lightweight';
ALTER TABLE "ServiceCapability" ALTER COLUMN "approvalStatus" DROP DEFAULT;
ALTER TABLE "ServiceCapability" ALTER COLUMN "approvalStatus" TYPE "ServiceCapabilityStatus" USING "approvalStatus"::"ServiceCapabilityStatus";
ALTER TABLE "ServiceCapability" ALTER COLUMN "approvalStatus" SET DEFAULT 'available';

ALTER TABLE "SupportRequest" ALTER COLUMN "urgency" DROP DEFAULT;
ALTER TABLE "SupportRequest" ALTER COLUMN "urgency" TYPE "UrgencyLevel" USING "urgency"::"UrgencyLevel";
ALTER TABLE "SupportRequest" ALTER COLUMN "urgency" SET DEFAULT 'normal';
ALTER TABLE "SupportRequest" ALTER COLUMN "privacyLevel" DROP DEFAULT;
ALTER TABLE "SupportRequest" ALTER COLUMN "privacyLevel" TYPE "PrivacyLevel" USING "privacyLevel"::"PrivacyLevel";
ALTER TABLE "SupportRequest" ALTER COLUMN "privacyLevel" SET DEFAULT 'private';
ALTER TABLE "SupportRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "SupportRequest" ALTER COLUMN "status" TYPE "SupportRequestStatus" USING "status"::"SupportRequestStatus";
ALTER TABLE "SupportRequest" ALTER COLUMN "status" SET DEFAULT 'open';

ALTER TABLE "TrustedServiceCapability" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TrustedServiceCapability" ALTER COLUMN "status" TYPE "TrustStatus" USING "status"::"TrustStatus";
ALTER TABLE "TrustedServiceCapability" ALTER COLUMN "status" SET DEFAULT 'petitioned';

-- CreateTable
CREATE TABLE "LinkedNodePresence" (
    "id" TEXT NOT NULL,
    "portableIdentityId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" "LinkedPresenceStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "LinkedNodePresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportRequestService" (
    "id" TEXT NOT NULL,
    "supportRequestId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "trustRequirement" "TrustRequirement" NOT NULL DEFAULT 'lightweight',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportRequestService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferService" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "trustRequirement" "TrustRequirement" NOT NULL DEFAULT 'lightweight',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionLog" (
    "id" TEXT NOT NULL,
    "actorAccountId" TEXT,
    "groupId" TEXT,
    "projectId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkedNodePresence_nodeId_idx" ON "LinkedNodePresence"("nodeId");

-- CreateIndex
CREATE INDEX "LinkedNodePresence_status_idx" ON "LinkedNodePresence"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedNodePresence_portableIdentityId_nodeId_key" ON "LinkedNodePresence"("portableIdentityId", "nodeId");

-- CreateIndex
CREATE INDEX "SupportRequestService_serviceType_idx" ON "SupportRequestService"("serviceType");

-- CreateIndex
CREATE INDEX "SupportRequestService_trustRequirement_idx" ON "SupportRequestService"("trustRequirement");

-- CreateIndex
CREATE UNIQUE INDEX "SupportRequestService_supportRequestId_serviceType_trustReq_key" ON "SupportRequestService"("supportRequestId", "serviceType", "trustRequirement");

-- CreateIndex
CREATE INDEX "OfferService_serviceType_idx" ON "OfferService"("serviceType");

-- CreateIndex
CREATE INDEX "OfferService_trustRequirement_idx" ON "OfferService"("trustRequirement");

-- CreateIndex
CREATE UNIQUE INDEX "OfferService_offerId_serviceType_trustRequirement_key" ON "OfferService"("offerId", "serviceType", "trustRequirement");

-- CreateIndex
CREATE INDEX "ActionLog_actorAccountId_idx" ON "ActionLog"("actorAccountId");

-- CreateIndex
CREATE INDEX "ActionLog_groupId_idx" ON "ActionLog"("groupId");

-- CreateIndex
CREATE INDEX "ActionLog_projectId_idx" ON "ActionLog"("projectId");

-- CreateIndex
CREATE INDEX "ActionLog_action_idx" ON "ActionLog"("action");

-- CreateIndex
CREATE INDEX "ActionLog_targetType_targetId_idx" ON "ActionLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ActionLog_createdAt_idx" ON "ActionLog"("createdAt");

-- CreateIndex
CREATE INDEX "Account_accountType_idx" ON "Account"("accountType");

-- CreateIndex
CREATE INDEX "Contribution_visibility_idx" ON "Contribution"("visibility");

-- CreateIndex
CREATE UNIQUE INDEX "Group_nodeId_name_key" ON "Group"("nodeId", "name");

-- CreateIndex
CREATE INDEX "Offer_expiresAt_idx" ON "Offer"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_groupId_name_key" ON "Project"("groupId", "name");

-- CreateIndex
CREATE INDEX "ServiceCapability_trustRequirement_idx" ON "ServiceCapability"("trustRequirement");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCapability_accountId_serviceType_trustRequirement_key" ON "ServiceCapability"("accountId", "serviceType", "trustRequirement");

-- CreateIndex
CREATE INDEX "SupportRequest_urgency_idx" ON "SupportRequest"("urgency");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedServiceCapability_serviceCapabilityId_groupId_trustC_key" ON "TrustedServiceCapability"("serviceCapabilityId", "groupId", "trustContext");

-- AddForeignKey
ALTER TABLE "LinkedNodePresence" ADD CONSTRAINT "LinkedNodePresence_portableIdentityId_fkey" FOREIGN KEY ("portableIdentityId") REFERENCES "PortableIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedNodePresence" ADD CONSTRAINT "LinkedNodePresence_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequestService" ADD CONSTRAINT "SupportRequestService_supportRequestId_fkey" FOREIGN KEY ("supportRequestId") REFERENCES "SupportRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferService" ADD CONSTRAINT "OfferService_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionLog" ADD CONSTRAINT "ActionLog_actorAccountId_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionLog" ADD CONSTRAINT "ActionLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionLog" ADD CONSTRAINT "ActionLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;