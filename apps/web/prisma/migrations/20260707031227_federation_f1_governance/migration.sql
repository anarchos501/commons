-- CreateTable
CREATE TABLE "Federation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "terms" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dissolvedAt" TIMESTAMP(3),

    CONSTRAINT "Federation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationMembership" (
    "id" TEXT NOT NULL,
    "federationId" TEXT NOT NULL,
    "memberDomain" TEXT NOT NULL,
    "federatedNodeId" TEXT,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,

    CONSTRAINT "FederationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationProposal" (
    "id" TEXT NOT NULL,
    "federationId" TEXT,
    "action" TEXT NOT NULL,
    "initiatedByDomain" TEXT NOT NULL,
    "name" TEXT,
    "content" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "participantSnapshot" JSONB NOT NULL,
    "decisions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closesAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FederationProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationProposalPetition" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "petitionId" TEXT NOT NULL,
    "nodeDomain" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FederationProposalPetition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Federation_status_idx" ON "Federation"("status");

-- CreateIndex
CREATE INDEX "FederationMembership_federatedNodeId_idx" ON "FederationMembership"("federatedNodeId");

-- CreateIndex
CREATE INDEX "FederationMembership_endedAt_idx" ON "FederationMembership"("endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FederationMembership_federationId_memberDomain_key" ON "FederationMembership"("federationId", "memberDomain");

-- CreateIndex
CREATE INDEX "FederationProposal_federationId_idx" ON "FederationProposal"("federationId");

-- CreateIndex
CREATE INDEX "FederationProposal_action_idx" ON "FederationProposal"("action");

-- CreateIndex
CREATE INDEX "FederationProposal_status_closesAt_idx" ON "FederationProposal"("status", "closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "FederationProposalPetition_petitionId_key" ON "FederationProposalPetition"("petitionId");

-- CreateIndex
CREATE INDEX "FederationProposalPetition_proposalId_idx" ON "FederationProposalPetition"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "FederationProposalPetition_proposalId_nodeDomain_key" ON "FederationProposalPetition"("proposalId", "nodeDomain");

-- AddForeignKey
ALTER TABLE "FederationMembership" ADD CONSTRAINT "FederationMembership_federationId_fkey" FOREIGN KEY ("federationId") REFERENCES "Federation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationMembership" ADD CONSTRAINT "FederationMembership_federatedNodeId_fkey" FOREIGN KEY ("federatedNodeId") REFERENCES "FederatedNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationProposal" ADD CONSTRAINT "FederationProposal_federationId_fkey" FOREIGN KEY ("federationId") REFERENCES "Federation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationProposalPetition" ADD CONSTRAINT "FederationProposalPetition_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "FederationProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- federation_policy_change is non-competing and reversible (the
-- custom_support_requests_toggle precedent): one open policy petition per
-- steward group at a time, enforced at the DB level. Target-independent so
-- two different policy targets cannot both be open.
CREATE UNIQUE INDEX "Petition_federation_policy_change_open_unique"
  ON "Petition"("groupId")
  WHERE "subjectType" = 'federation_policy_change' AND "status" = 'open';
