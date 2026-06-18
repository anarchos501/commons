-- CreateTable
CREATE TABLE "NodeNameProposal" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "initiatingGroupId" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "groupPetitionId" TEXT,
    "nodePetitionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_group',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "NodeNameProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NodeNameProposal_groupPetitionId_key" ON "NodeNameProposal"("groupPetitionId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeNameProposal_nodePetitionId_key" ON "NodeNameProposal"("nodePetitionId");

-- CreateIndex
CREATE INDEX "NodeNameProposal_nodeId_status_idx" ON "NodeNameProposal"("nodeId", "status");

-- CreateIndex
CREATE INDEX "NodeNameProposal_initiatingGroupId_idx" ON "NodeNameProposal"("initiatingGroupId");

-- AddForeignKey
ALTER TABLE "NodeNameProposal" ADD CONSTRAINT "NodeNameProposal_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeNameProposal" ADD CONSTRAINT "NodeNameProposal_initiatingGroupId_fkey" FOREIGN KEY ("initiatingGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
