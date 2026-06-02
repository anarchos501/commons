-- CreateTable
CREATE TABLE "Petition" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "competitionKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "governanceSnapshot" JSONB NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdByMembershipId" TEXT NOT NULL,

    CONSTRAINT "Petition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PetitionSupport" (
    "id" TEXT NOT NULL,
    "petitionId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PetitionSupport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Petition_groupId_status_idx" ON "Petition"("groupId", "status");

-- CreateIndex
CREATE INDEX "Petition_category_idx" ON "Petition"("category");

-- CreateIndex
CREATE INDEX "Petition_competitionKey_idx" ON "Petition"("competitionKey");

-- CreateIndex
CREATE INDEX "Petition_subjectType_subjectId_idx" ON "Petition"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "PetitionSupport_petitionId_idx" ON "PetitionSupport"("petitionId");

-- CreateIndex
CREATE UNIQUE INDEX "PetitionSupport_petitionId_membershipId_key" ON "PetitionSupport"("petitionId", "membershipId");

-- AddForeignKey
ALTER TABLE "Petition" ADD CONSTRAINT "Petition_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Petition" ADD CONSTRAINT "Petition_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetitionSupport" ADD CONSTRAINT "PetitionSupport_petitionId_fkey" FOREIGN KEY ("petitionId") REFERENCES "Petition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetitionSupport" ADD CONSTRAINT "PetitionSupport_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
