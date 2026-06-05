-- CreateEnum
CREATE TYPE "GroupVisibility" AS ENUM ('private', 'public');

-- DropForeignKey
ALTER TABLE "ContributionCategoryDraft" DROP CONSTRAINT "ContributionCategoryDraft_proposedByMembershipId_fkey";

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "visibility" "GroupVisibility" NOT NULL DEFAULT 'private';

-- AddForeignKey
ALTER TABLE "ContributionCategoryDraft" ADD CONSTRAINT "ContributionCategoryDraft_proposedByMembershipId_fkey" FOREIGN KEY ("proposedByMembershipId") REFERENCES "GroupMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
