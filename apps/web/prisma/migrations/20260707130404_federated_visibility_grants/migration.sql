-- CreateTable
CREATE TABLE "FederatedVisibilityGrant" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "federatedNodeId" TEXT NOT NULL,
    "stance" TEXT NOT NULL DEFAULT 'closed',
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FederatedVisibilityGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FederatedVisibilityGrant_federatedNodeId_idx" ON "FederatedVisibilityGrant"("federatedNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "FederatedVisibilityGrant_groupId_federatedNodeId_key" ON "FederatedVisibilityGrant"("groupId", "federatedNodeId");

-- AddForeignKey
ALTER TABLE "FederatedVisibilityGrant" ADD CONSTRAINT "FederatedVisibilityGrant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederatedVisibilityGrant" ADD CONSTRAINT "FederatedVisibilityGrant_federatedNodeId_fkey" FOREIGN KEY ("federatedNodeId") REFERENCES "FederatedNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One open stance petition per (group, peer) at a time: the subjectId encodes
-- `${groupId}:${peerNodeId}:${target}`, so uniqueness keys on the peer segment.
-- Reversible settings must not use competition keys (see deriveCompetitionKey
-- comment; register F-7 caution: this index IS the single-open invariant).
CREATE UNIQUE INDEX "Petition_federated_visibility_open_unique"
  ON "Petition"("groupId", split_part("subjectId", ':', 2))
  WHERE "subjectType" = 'federated_visibility_change' AND "status" = 'open';
