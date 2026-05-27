-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "constitutionalPreferences" JSONB,
    "federationPolicy" TEXT NOT NULL DEFAULT 'disabled',
    "pluginPolicy" TEXT NOT NULL DEFAULT 'disabled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortableIdentity" (
    "id" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortableIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "portableIdentityId" TEXT,
    "homeNodeId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'guest',
    "publicKey" TEXT,
    "profileVisibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "membershipPolicy" TEXT NOT NULL DEFAULT 'open',
    "governancePreferences" JSONB,
    "privacyPreferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "governancePreferences" JSONB,
    "privacyPreferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCapability" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "description" TEXT,
    "availability" JSONB,
    "visibility" TEXT NOT NULL DEFAULT 'group',
    "trustRequirement" TEXT NOT NULL DEFAULT 'lightweight',
    "approvalStatus" TEXT NOT NULL DEFAULT 'available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedServiceCapability" (
    "id" TEXT NOT NULL,
    "serviceCapabilityId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "trustContext" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'petitioned',
    "supportThreshold" DOUBLE PRECISION,
    "reviewEndsAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedServiceCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "submittedByAccountId" TEXT,
    "groupId" TEXT NOT NULL,
    "projectId" TEXT,
    "requestType" TEXT NOT NULL,
    "requestedServices" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "privacyLevel" TEXT NOT NULL DEFAULT 'private',
    "status" TEXT NOT NULL DEFAULT 'open',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "projectId" TEXT,
    "supportRequestId" TEXT,
    "offeredServices" JSONB NOT NULL,
    "description" TEXT,
    "availability" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "privacyLevel" TEXT NOT NULL DEFAULT 'group',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contribution" (
    "id" TEXT NOT NULL,
    "contributorAccountId" TEXT NOT NULL,
    "groupId" TEXT,
    "projectId" TEXT,
    "contributionType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'group',
    "privacyEnvelope" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "governancePreferencesSnapshot" JSONB,
    "createdByAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "roleType" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "groupId" TEXT,
    "projectId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "recallPolicy" TEXT NOT NULL DEFAULT 'proposal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernancePreference" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "changeRule" TEXT NOT NULL DEFAULT 'mutable',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernancePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyEnvelope" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'private',
    "rules" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Node_domain_key" ON "Node"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "PortableIdentity_did_key" ON "PortableIdentity"("did");

-- CreateIndex
CREATE INDEX "Account_homeNodeId_idx" ON "Account"("homeNodeId");

-- CreateIndex
CREATE INDEX "Account_portableIdentityId_idx" ON "Account"("portableIdentityId");

-- CreateIndex
CREATE INDEX "Group_nodeId_idx" ON "Group"("nodeId");

-- CreateIndex
CREATE INDEX "Project_groupId_idx" ON "Project"("groupId");

-- CreateIndex
CREATE INDEX "ServiceCapability_accountId_idx" ON "ServiceCapability"("accountId");

-- CreateIndex
CREATE INDEX "ServiceCapability_serviceType_idx" ON "ServiceCapability"("serviceType");

-- CreateIndex
CREATE INDEX "ServiceCapability_approvalStatus_idx" ON "ServiceCapability"("approvalStatus");

-- CreateIndex
CREATE INDEX "TrustedServiceCapability_serviceCapabilityId_idx" ON "TrustedServiceCapability"("serviceCapabilityId");

-- CreateIndex
CREATE INDEX "TrustedServiceCapability_groupId_idx" ON "TrustedServiceCapability"("groupId");

-- CreateIndex
CREATE INDEX "TrustedServiceCapability_status_idx" ON "TrustedServiceCapability"("status");

-- CreateIndex
CREATE INDEX "SupportRequest_submittedByAccountId_idx" ON "SupportRequest"("submittedByAccountId");

-- CreateIndex
CREATE INDEX "SupportRequest_groupId_idx" ON "SupportRequest"("groupId");

-- CreateIndex
CREATE INDEX "SupportRequest_projectId_idx" ON "SupportRequest"("projectId");

-- CreateIndex
CREATE INDEX "SupportRequest_status_idx" ON "SupportRequest"("status");

-- CreateIndex
CREATE INDEX "SupportRequest_expiresAt_idx" ON "SupportRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "Offer_accountId_idx" ON "Offer"("accountId");

-- CreateIndex
CREATE INDEX "Offer_groupId_idx" ON "Offer"("groupId");

-- CreateIndex
CREATE INDEX "Offer_projectId_idx" ON "Offer"("projectId");

-- CreateIndex
CREATE INDEX "Offer_supportRequestId_idx" ON "Offer"("supportRequestId");

-- CreateIndex
CREATE INDEX "Offer_status_idx" ON "Offer"("status");

-- CreateIndex
CREATE INDEX "Contribution_contributorAccountId_idx" ON "Contribution"("contributorAccountId");

-- CreateIndex
CREATE INDEX "Contribution_groupId_idx" ON "Contribution"("groupId");

-- CreateIndex
CREATE INDEX "Contribution_projectId_idx" ON "Contribution"("projectId");

-- CreateIndex
CREATE INDEX "Contribution_occurredAt_idx" ON "Contribution"("occurredAt");

-- CreateIndex
CREATE INDEX "Proposal_groupId_idx" ON "Proposal"("groupId");

-- CreateIndex
CREATE INDEX "Proposal_projectId_idx" ON "Proposal"("projectId");

-- CreateIndex
CREATE INDEX "Proposal_createdByAccountId_idx" ON "Proposal"("createdByAccountId");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE INDEX "Role_accountId_idx" ON "Role"("accountId");

-- CreateIndex
CREATE INDEX "Role_groupId_idx" ON "Role"("groupId");

-- CreateIndex
CREATE INDEX "Role_projectId_idx" ON "Role"("projectId");

-- CreateIndex
CREATE INDEX "Role_expiresAt_idx" ON "Role"("expiresAt");

-- CreateIndex
CREATE INDEX "GovernancePreference_scope_scopeId_idx" ON "GovernancePreference"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "GovernancePreference_key_idx" ON "GovernancePreference"("key");

-- CreateIndex
CREATE INDEX "PrivacyEnvelope_level_idx" ON "PrivacyEnvelope"("level");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyEnvelope_targetType_targetId_key" ON "PrivacyEnvelope"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_portableIdentityId_fkey" FOREIGN KEY ("portableIdentityId") REFERENCES "PortableIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_homeNodeId_fkey" FOREIGN KEY ("homeNodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCapability" ADD CONSTRAINT "ServiceCapability_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedServiceCapability" ADD CONSTRAINT "TrustedServiceCapability_serviceCapabilityId_fkey" FOREIGN KEY ("serviceCapabilityId") REFERENCES "ServiceCapability"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedServiceCapability" ADD CONSTRAINT "TrustedServiceCapability_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_submittedByAccountId_fkey" FOREIGN KEY ("submittedByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_supportRequestId_fkey" FOREIGN KEY ("supportRequestId") REFERENCES "SupportRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_contributorAccountId_fkey" FOREIGN KEY ("contributorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
