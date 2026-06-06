-- CreateTable
CREATE TABLE "GroupInviteToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPreview" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "GroupInviteToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupInviteToken_tokenHash_key" ON "GroupInviteToken"("tokenHash");

-- CreateIndex
CREATE INDEX "GroupInviteToken_groupId_idx" ON "GroupInviteToken"("groupId");

-- AddForeignKey
ALTER TABLE "GroupInviteToken" ADD CONSTRAINT "GroupInviteToken_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInviteToken" ADD CONSTRAINT "GroupInviteToken_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
