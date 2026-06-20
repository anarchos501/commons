-- AlterTable
ALTER TABLE "GroupMembership" ADD COLUMN     "decidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectMembership" ADD COLUMN     "decidedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "enableRequests" BOOLEAN NOT NULL DEFAULT true,
    "enablePetitions" BOOLEAN NOT NULL DEFAULT true,
    "enableOutcomes" BOOLEAN NOT NULL DEFAULT true,
    "enableSafety" BOOLEAN NOT NULL DEFAULT true,
    "enableUpdates" BOOLEAN NOT NULL DEFAULT true,
    "rollUpUpdates" BOOLEAN NOT NULL DEFAULT true,
    "mutedSpaces" JSONB,
    "outcomesSeenAt" TIMESTAMP(3),
    "safetySeenAt" TIMESTAMP(3),
    "updatesSeenAt" TIMESTAMP(3),
    "aboutYouSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_accountId_key" ON "NotificationPreference"("accountId");

-- CreateIndex
CREATE INDEX "GroupMembership_accountId_decidedAt_idx" ON "GroupMembership"("accountId", "decidedAt");

-- CreateIndex
CREATE INDEX "ProjectMembership_accountId_decidedAt_idx" ON "ProjectMembership"("accountId", "decidedAt");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
