-- CreateTable
CREATE TABLE "MemberGovernanceSignal" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "signal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberGovernanceSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberGovernanceSignal_groupId_category_idx" ON "MemberGovernanceSignal"("groupId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "MemberGovernanceSignal_membershipId_category_key" ON "MemberGovernanceSignal"("membershipId", "category");

-- AddForeignKey
ALTER TABLE "MemberGovernanceSignal" ADD CONSTRAINT "MemberGovernanceSignal_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberGovernanceSignal" ADD CONSTRAINT "MemberGovernanceSignal_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
