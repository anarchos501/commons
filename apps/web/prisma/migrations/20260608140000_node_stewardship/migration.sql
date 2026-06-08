-- RFC-007 Phase 5: node hosts, stewardship, and account-deduplicated node governance.

ALTER TABLE "Node" ADD COLUMN "stewardGroupId" TEXT;
ALTER TABLE "Petition" ADD COLUMN "createdByAccountId" TEXT;
ALTER TABLE "ActionLog" ADD COLUMN "nodeId" TEXT;

CREATE TABLE "NodeHost" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "NodeHost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NodeGovernanceSignal" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "parameter" TEXT NOT NULL DEFAULT '_',
    "signal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NodeGovernanceSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NodeStewardProposal" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "candidateGroupId" TEXT NOT NULL,
    "initiatingGroupId" TEXT,
    "initiatedByAccountId" TEXT,
    "baselineStewardGroupId" TEXT,
    "groupInitiationPetitionId" TEXT,
    "candidateConsentPetitionId" TEXT,
    "nodePetitionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "NodeStewardProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NodePetitionSupport" (
    "id" TEXT NOT NULL,
    "petitionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NodePetitionSupport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NodeHost_active_unique"
ON "NodeHost"("nodeId", "accountId")
WHERE "revokedAt" IS NULL;
CREATE INDEX "NodeHost_nodeId_idx" ON "NodeHost"("nodeId");
CREATE INDEX "NodeHost_accountId_idx" ON "NodeHost"("accountId");
CREATE INDEX "NodeHost_revokedAt_idx" ON "NodeHost"("revokedAt");

CREATE UNIQUE INDEX "NodeGovernanceSignal_accountId_nodeId_category_parameter_key"
ON "NodeGovernanceSignal"("accountId", "nodeId", "category", "parameter");
CREATE INDEX "NodeGovernanceSignal_nodeId_category_idx"
ON "NodeGovernanceSignal"("nodeId", "category");

CREATE UNIQUE INDEX "NodeStewardProposal_groupInitiationPetitionId_key"
ON "NodeStewardProposal"("groupInitiationPetitionId");
CREATE UNIQUE INDEX "NodeStewardProposal_candidateConsentPetitionId_key"
ON "NodeStewardProposal"("candidateConsentPetitionId");
CREATE UNIQUE INDEX "NodeStewardProposal_nodePetitionId_key"
ON "NodeStewardProposal"("nodePetitionId");
CREATE INDEX "NodeStewardProposal_nodeId_status_idx"
ON "NodeStewardProposal"("nodeId", "status");
CREATE INDEX "NodeStewardProposal_candidateGroupId_idx"
ON "NodeStewardProposal"("candidateGroupId");
CREATE INDEX "NodeStewardProposal_initiatingGroupId_idx"
ON "NodeStewardProposal"("initiatingGroupId");
CREATE INDEX "NodeStewardProposal_initiatedByAccountId_idx"
ON "NodeStewardProposal"("initiatedByAccountId");

CREATE UNIQUE INDEX "NodePetitionSupport_petitionId_accountId_key"
ON "NodePetitionSupport"("petitionId", "accountId");
CREATE INDEX "NodePetitionSupport_nodeId_accountId_idx"
ON "NodePetitionSupport"("nodeId", "accountId");

CREATE INDEX "Node_stewardGroupId_idx" ON "Node"("stewardGroupId");
CREATE INDEX "ActionLog_nodeId_idx" ON "ActionLog"("nodeId");

ALTER TABLE "Node"
ADD CONSTRAINT "Node_stewardGroupId_fkey"
FOREIGN KEY ("stewardGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Petition"
ADD CONSTRAINT "Petition_createdByAccountId_fkey"
FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActionLog"
ADD CONSTRAINT "ActionLog_nodeId_fkey"
FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NodeHost"
ADD CONSTRAINT "NodeHost_nodeId_fkey"
FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodeHost"
ADD CONSTRAINT "NodeHost_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NodeGovernanceSignal"
ADD CONSTRAINT "NodeGovernanceSignal_nodeId_fkey"
FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodeGovernanceSignal"
ADD CONSTRAINT "NodeGovernanceSignal_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NodeStewardProposal"
ADD CONSTRAINT "NodeStewardProposal_nodeId_fkey"
FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodeStewardProposal"
ADD CONSTRAINT "NodeStewardProposal_candidateGroupId_fkey"
FOREIGN KEY ("candidateGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NodeStewardProposal"
ADD CONSTRAINT "NodeStewardProposal_initiatingGroupId_fkey"
FOREIGN KEY ("initiatingGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NodeStewardProposal"
ADD CONSTRAINT "NodeStewardProposal_initiatedByAccountId_fkey"
FOREIGN KEY ("initiatedByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NodePetitionSupport"
ADD CONSTRAINT "NodePetitionSupport_petitionId_fkey"
FOREIGN KEY ("petitionId") REFERENCES "Petition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodePetitionSupport"
ADD CONSTRAINT "NodePetitionSupport_nodeId_fkey"
FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodePetitionSupport"
ADD CONSTRAINT "NodePetitionSupport_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
