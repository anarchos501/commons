-- DropForeignKey
ALTER TABLE "CoalitionMembership" DROP CONSTRAINT "CoalitionMembership_groupId_fkey";

-- AlterTable
ALTER TABLE "CoalitionMembership" ALTER COLUMN "groupId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CoalitionMembership" ADD CONSTRAINT "CoalitionMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
