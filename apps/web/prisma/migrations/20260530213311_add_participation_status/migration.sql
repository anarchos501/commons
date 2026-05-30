-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('active', 'quiet', 'dormant');

-- AlterTable
ALTER TABLE "GroupMembership" ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "participationStatus" "ParticipationStatus" NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE INDEX "GroupMembership_groupId_participationStatus_idx" ON "GroupMembership"("groupId", "participationStatus");
