-- AlterTable
ALTER TABLE "FederatedNode" ADD COLUMN     "lastOutboundOkAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IdentityKeyCustody" ADD COLUMN     "escrowSalt" TEXT,
ADD COLUMN     "escrowUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "escrowWrappedKey" TEXT;

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "backupHostingPolicy" TEXT NOT NULL DEFAULT 'approve_each',
ADD COLUMN     "backupMemberThreshold" INTEGER;

-- CreateTable
CREATE TABLE "EntityBackup" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "windowHours" INTEGER NOT NULL DEFAULT 24,
    "directive" TEXT NOT NULL DEFAULT 'none',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "establishedAt" TIMESTAMP(3),
    "manifestSeq" INTEGER NOT NULL DEFAULT 0,
    "lastManifest" JSONB,
    "lastReplicatedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "takeoverState" TEXT NOT NULL DEFAULT 'none',
    "lastAppliedSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityBackup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupReplica" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "originPeerId" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "windowHours" INTEGER NOT NULL,
    "directive" TEXT NOT NULL DEFAULT 'none',
    "manifest" JSONB,
    "manifestSeq" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending_consent',
    "consentPetitionId" TEXT,
    "challengeOpenedAt" TIMESTAMP(3),
    "lastProofOfLifeAt" TIMESTAMP(3),
    "expediteApprovedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "cededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupReplica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoverLogEntry" (
    "id" TEXT NOT NULL,
    "replicaId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "actionType" TEXT NOT NULL,
    "action" JSONB NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "actorAccountId" TEXT,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoverLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityBackup_peerId_idx" ON "EntityBackup"("peerId");

-- CreateIndex
CREATE INDEX "EntityBackup_status_idx" ON "EntityBackup"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EntityBackup_entityType_entityId_key" ON "EntityBackup"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "BackupReplica_status_idx" ON "BackupReplica"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BackupReplica_entityType_entityId_originPeerId_key" ON "BackupReplica"("entityType", "entityId", "originPeerId");

-- CreateIndex
CREATE UNIQUE INDEX "TakeoverLogEntry_replicaId_seq_key" ON "TakeoverLogEntry"("replicaId", "seq");

-- AddForeignKey
ALTER TABLE "EntityBackup" ADD CONSTRAINT "EntityBackup_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "FederatedNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupReplica" ADD CONSTRAINT "BackupReplica_originPeerId_fkey" FOREIGN KEY ("originPeerId") REFERENCES "FederatedNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoverLogEntry" ADD CONSTRAINT "TakeoverLogEntry_replicaId_fkey" FOREIGN KEY ("replicaId") REFERENCES "BackupReplica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- register F-7: single-open invariants are DB constraints. One open
-- designation petition per (entityType, entityId, peer), any direction:
CREATE UNIQUE INDEX "Petition_backup_designation_open_unique"
  ON "Petition"(split_part("subjectId", ':', 1), split_part("subjectId", ':', 2), split_part("subjectId", ':', 3))
  WHERE "subjectType" = 'backup_designation' AND "status" = 'open';
-- One open hosting-consent petition per replica:
CREATE UNIQUE INDEX "Petition_backup_hosting_consent_open_unique"
  ON "Petition"("subjectId")
  WHERE "subjectType" = 'backup_hosting_consent' AND "status" = 'open';
-- One open hosting-end petition per replica:
CREATE UNIQUE INDEX "Petition_backup_hosting_end_open_unique"
  ON "Petition"("subjectId")
  WHERE "subjectType" = 'backup_hosting_end' AND "status" = 'open';
-- One open node-wide threshold vote per node:
CREATE UNIQUE INDEX "Petition_backup_size_threshold_open_unique"
  ON "Petition"("scopeId")
  WHERE "subjectType" = 'backup_size_threshold_change' AND "status" = 'open';
-- One open hosting-policy petition per node (steward-group family):
CREATE UNIQUE INDEX "Petition_backup_hosting_policy_open_unique"
  ON "Petition"(split_part("subjectId", ':', 1))
  WHERE "subjectType" = 'backup_hosting_policy_change' AND "status" = 'open';
