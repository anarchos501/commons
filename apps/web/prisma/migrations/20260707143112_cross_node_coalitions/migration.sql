-- AlterTable
ALTER TABLE "CoalitionMembership" ADD COLUMN     "federatedGroupPresenceId" TEXT;

-- AlterTable
ALTER TABLE "CoalitionProposal" ADD COLUMN     "decisions" JSONB,
ADD COLUMN     "homeNodeDomain" TEXT;

-- CreateTable
CREATE TABLE "FederatedGroupPresence" (
    "id" TEXT NOT NULL,
    "federatedNodeId" TEXT NOT NULL,
    "remoteGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FederatedGroupPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederatedCoalitionPresence" (
    "id" TEXT NOT NULL,
    "coalitionId" TEXT NOT NULL,
    "homeFederatedNodeId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FederatedCoalitionPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederatedCoalitionMessage" (
    "id" TEXT NOT NULL,
    "presenceId" TEXT NOT NULL,
    "remoteMessageId" TEXT NOT NULL,
    "originDomain" TEXT NOT NULL,
    "authorLabel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FederatedCoalitionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FederatedGroupPresence_federatedNodeId_remoteGroupId_key" ON "FederatedGroupPresence"("federatedNodeId", "remoteGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "FederatedCoalitionPresence_coalitionId_groupId_key" ON "FederatedCoalitionPresence"("coalitionId", "groupId");

-- CreateIndex
CREATE INDEX "FederatedCoalitionMessage_presenceId_postedAt_idx" ON "FederatedCoalitionMessage"("presenceId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FederatedCoalitionMessage_presenceId_remoteMessageId_key" ON "FederatedCoalitionMessage"("presenceId", "remoteMessageId");

-- AddForeignKey
ALTER TABLE "FederatedGroupPresence" ADD CONSTRAINT "FederatedGroupPresence_federatedNodeId_fkey" FOREIGN KEY ("federatedNodeId") REFERENCES "FederatedNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederatedCoalitionPresence" ADD CONSTRAINT "FederatedCoalitionPresence_homeFederatedNodeId_fkey" FOREIGN KEY ("homeFederatedNodeId") REFERENCES "FederatedNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederatedCoalitionPresence" ADD CONSTRAINT "FederatedCoalitionPresence_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederatedCoalitionMessage" ADD CONSTRAINT "FederatedCoalitionMessage_presenceId_fkey" FOREIGN KEY ("presenceId") REFERENCES "FederatedCoalitionPresence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoalitionMembership" ADD CONSTRAINT "CoalitionMembership_federatedGroupPresenceId_fkey" FOREIGN KEY ("federatedGroupPresenceId") REFERENCES "FederatedGroupPresence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
