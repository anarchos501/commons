-- RFC-007 Phase 1 hardening and Phase 2 coalitions.

ALTER TYPE "CoordinationSpaceType" ADD VALUE 'coalition';
ALTER TYPE "GovernanceScope" ADD VALUE 'coalition';

ALTER TABLE "Project" ADD COLUMN "pendingClosureElectorate" JSONB;

CREATE UNIQUE INDEX "ProjectHostingProposal_groupPetitionId_key"
ON "ProjectHostingProposal"("groupPetitionId");

CREATE UNIQUE INDEX "ProjectHostingProposal_projectPetitionId_key"
ON "ProjectHostingProposal"("projectPetitionId");

CREATE TABLE "Coalition" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dissolvedAt" TIMESTAMP(3),

    CONSTRAINT "Coalition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoalitionMembership" (
    "id" TEXT NOT NULL,
    "coalitionId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,

    CONSTRAINT "CoalitionMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoalitionProposal" (
    "id" TEXT NOT NULL,
    "coalitionId" TEXT,
    "action" TEXT NOT NULL,
    "proposedByGroupId" TEXT NOT NULL,
    "targetGroupId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "participantSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CoalitionProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoalitionProposalPetition" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "petitionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "groupSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoalitionProposalPetition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Coalition_nodeId_name_key" ON "Coalition"("nodeId", "name");
CREATE INDEX "Coalition_nodeId_idx" ON "Coalition"("nodeId");
CREATE INDEX "Coalition_status_idx" ON "Coalition"("status");

CREATE UNIQUE INDEX "CoalitionMembership_active_unique"
ON "CoalitionMembership"("coalitionId", "groupId")
WHERE "endedAt" IS NULL;
CREATE INDEX "CoalitionMembership_coalitionId_idx" ON "CoalitionMembership"("coalitionId");
CREATE INDEX "CoalitionMembership_groupId_idx" ON "CoalitionMembership"("groupId");
CREATE INDEX "CoalitionMembership_endedAt_idx" ON "CoalitionMembership"("endedAt");

CREATE INDEX "CoalitionProposal_coalitionId_idx" ON "CoalitionProposal"("coalitionId");
CREATE INDEX "CoalitionProposal_proposedByGroupId_idx" ON "CoalitionProposal"("proposedByGroupId");
CREATE INDEX "CoalitionProposal_targetGroupId_idx" ON "CoalitionProposal"("targetGroupId");
CREATE INDEX "CoalitionProposal_action_idx" ON "CoalitionProposal"("action");
CREATE INDEX "CoalitionProposal_status_idx" ON "CoalitionProposal"("status");

CREATE UNIQUE INDEX "CoalitionProposalPetition_petitionId_key"
ON "CoalitionProposalPetition"("petitionId");
CREATE UNIQUE INDEX "CoalitionProposalPetition_proposalId_groupId_key"
ON "CoalitionProposalPetition"("proposalId", "groupId");
CREATE INDEX "CoalitionProposalPetition_proposalId_idx" ON "CoalitionProposalPetition"("proposalId");
CREATE INDEX "CoalitionProposalPetition_groupId_idx" ON "CoalitionProposalPetition"("groupId");

ALTER TABLE "Coalition"
ADD CONSTRAINT "Coalition_nodeId_fkey"
FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CoalitionMembership"
ADD CONSTRAINT "CoalitionMembership_coalitionId_fkey"
FOREIGN KEY ("coalitionId") REFERENCES "Coalition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CoalitionMembership"
ADD CONSTRAINT "CoalitionMembership_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CoalitionProposal"
ADD CONSTRAINT "CoalitionProposal_coalitionId_fkey"
FOREIGN KEY ("coalitionId") REFERENCES "Coalition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CoalitionProposal"
ADD CONSTRAINT "CoalitionProposal_proposedByGroupId_fkey"
FOREIGN KEY ("proposedByGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CoalitionProposalPetition"
ADD CONSTRAINT "CoalitionProposalPetition_proposalId_fkey"
FOREIGN KEY ("proposalId") REFERENCES "CoalitionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoalitionProposalPetition"
ADD CONSTRAINT "CoalitionProposalPetition_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
