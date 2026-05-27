-- CreateEnum
CREATE TYPE "SignedEventType" AS ENUM ('proposal_created', 'support_request_submitted', 'contribution_logged', 'identity_presence_updated', 'governance_preference_changed', 'migration_prepared');

-- CreateEnum
CREATE TYPE "DataClass" AS ENUM ('offline_draft', 'personal_note', 'local_reminder', 'private_availability', 'cached_coordination_history', 'sync_queue_item', 'support_request', 'offer', 'contribution', 'proposal', 'governance_preference', 'portable_identity', 'linked_node_presence');

-- CreateEnum
CREATE TYPE "NodeStoragePolicy" AS ENUM ('none', 'temporary', 'canonical', 'reference');

-- CreateEnum
CREATE TYPE "LocalStoragePolicy" AS ENUM ('none', 'cache', 'draft', 'private_data', 'sync_queue');

-- CreateTable
CREATE TABLE "SignedEvent" (
    "id" TEXT NOT NULL,
    "eventType" "SignedEventType" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "actorAccountId" TEXT,
    "portableIdentityId" TEXT,
    "nodeId" TEXT,
    "groupId" TEXT,
    "projectId" TEXT,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalSyncState" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "lastAckedEventId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataReplicationPolicy" (
    "id" TEXT NOT NULL,
    "scope" "GovernanceScope" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "dataClass" "DataClass" NOT NULL,
    "nodeStorage" "NodeStoragePolicy" NOT NULL,
    "localStorage" "LocalStoragePolicy" NOT NULL,
    "federationAllowed" BOOLEAN NOT NULL DEFAULT false,
    "p2pAllowed" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER,
    "requiresEncryption" BOOLEAN NOT NULL DEFAULT true,
    "userExportAllowed" BOOLEAN NOT NULL DEFAULT true,
    "userDeletionAllowed" BOOLEAN NOT NULL DEFAULT true,
    "syncRequiresConsent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataReplicationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignedEvent_eventType_idx" ON "SignedEvent"("eventType");

-- CreateIndex
CREATE INDEX "SignedEvent_subjectType_subjectId_idx" ON "SignedEvent"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "SignedEvent_actorAccountId_idx" ON "SignedEvent"("actorAccountId");

-- CreateIndex
CREATE INDEX "SignedEvent_portableIdentityId_idx" ON "SignedEvent"("portableIdentityId");

-- CreateIndex
CREATE INDEX "SignedEvent_nodeId_idx" ON "SignedEvent"("nodeId");

-- CreateIndex
CREATE INDEX "SignedEvent_groupId_idx" ON "SignedEvent"("groupId");

-- CreateIndex
CREATE INDEX "SignedEvent_projectId_idx" ON "SignedEvent"("projectId");

-- CreateIndex
CREATE INDEX "SignedEvent_createdAt_idx" ON "SignedEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SignedEvent_payloadHash_signature_key" ON "SignedEvent"("payloadHash", "signature");

-- CreateIndex
CREATE INDEX "LocalSyncState_lastAckedEventId_idx" ON "LocalSyncState"("lastAckedEventId");

-- CreateIndex
CREATE INDEX "LocalSyncState_lastSyncedAt_idx" ON "LocalSyncState"("lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocalSyncState_accountId_deviceId_key" ON "LocalSyncState"("accountId", "deviceId");

-- CreateIndex
CREATE INDEX "DataReplicationPolicy_dataClass_idx" ON "DataReplicationPolicy"("dataClass");

-- CreateIndex
CREATE INDEX "DataReplicationPolicy_scope_scopeId_idx" ON "DataReplicationPolicy"("scope", "scopeId");

-- CreateIndex
CREATE INDEX "DataReplicationPolicy_federationAllowed_idx" ON "DataReplicationPolicy"("federationAllowed");

-- CreateIndex
CREATE INDEX "DataReplicationPolicy_p2pAllowed_idx" ON "DataReplicationPolicy"("p2pAllowed");

-- CreateIndex
CREATE UNIQUE INDEX "DataReplicationPolicy_scope_scopeId_dataClass_key" ON "DataReplicationPolicy"("scope", "scopeId", "dataClass");

-- AddForeignKey
ALTER TABLE "SignedEvent" ADD CONSTRAINT "SignedEvent_actorAccountId_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedEvent" ADD CONSTRAINT "SignedEvent_portableIdentityId_fkey" FOREIGN KEY ("portableIdentityId") REFERENCES "PortableIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedEvent" ADD CONSTRAINT "SignedEvent_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedEvent" ADD CONSTRAINT "SignedEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedEvent" ADD CONSTRAINT "SignedEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalSyncState" ADD CONSTRAINT "LocalSyncState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
