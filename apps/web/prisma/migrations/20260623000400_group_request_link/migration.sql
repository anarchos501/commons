-- Feedback #9: shareable, durable request link so a private group can receive support
-- requests via an unlisted link without becoming publicly discoverable.
-- CreateTable
CREATE TABLE "GroupRequestLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPreview" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "GroupRequestLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupRequestLink_tokenHash_key" ON "GroupRequestLink"("tokenHash");

-- CreateIndex
CREATE INDEX "GroupRequestLink_groupId_idx" ON "GroupRequestLink"("groupId");

-- AddForeignKey
ALTER TABLE "GroupRequestLink" ADD CONSTRAINT "GroupRequestLink_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupRequestLink" ADD CONSTRAINT "GroupRequestLink_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
