-- CreateTable
CREATE TABLE "NodeKeyPair" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
    "publicKey" TEXT NOT NULL,
    "privateKeyPem" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "NodeKeyPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederatedNode" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "displayName" TEXT,
    "publicKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "policySnapshot" JSONB,
    "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "FederatedNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationOutboxItem" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "FederationOutboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationInboundEvent" (
    "id" TEXT NOT NULL,
    "originNodeId" TEXT NOT NULL,
    "remoteEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "error" TEXT,

    CONSTRAINT "FederationInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NodeKeyPair_nodeId_idx" ON "NodeKeyPair"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "FederatedNode_domain_key" ON "FederatedNode"("domain");

-- CreateIndex
CREATE INDEX "FederatedNode_status_idx" ON "FederatedNode"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FederationOutboxItem_eventId_key" ON "FederationOutboxItem"("eventId");

-- CreateIndex
CREATE INDEX "FederationOutboxItem_status_nextAttemptAt_idx" ON "FederationOutboxItem"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "FederationOutboxItem_peerId_idx" ON "FederationOutboxItem"("peerId");

-- CreateIndex
CREATE INDEX "FederationInboundEvent_originNodeId_idx" ON "FederationInboundEvent"("originNodeId");

-- CreateIndex
CREATE INDEX "FederationInboundEvent_eventType_idx" ON "FederationInboundEvent"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "FederationInboundEvent_originNodeId_remoteEventId_key" ON "FederationInboundEvent"("originNodeId", "remoteEventId");

-- AddForeignKey
ALTER TABLE "NodeKeyPair" ADD CONSTRAINT "NodeKeyPair_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationOutboxItem" ADD CONSTRAINT "FederationOutboxItem_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "FederatedNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationInboundEvent" ADD CONSTRAINT "FederationInboundEvent_originNodeId_fkey" FOREIGN KEY ("originNodeId") REFERENCES "FederatedNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One active (unretired) signing key per node; retired rows are kept for
-- rotation history and re-verification of old signatures (F5).
CREATE UNIQUE INDEX "NodeKeyPair_active_per_node_unique" ON "NodeKeyPair"("nodeId") WHERE "retiredAt" IS NULL;
