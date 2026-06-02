-- DropForeignKey
ALTER TABLE "Petition" DROP CONSTRAINT "Petition_createdByMembershipId_fkey";

-- DropForeignKey
ALTER TABLE "PetitionSupport" DROP CONSTRAINT "PetitionSupport_membershipId_fkey";

-- DropForeignKey
ALTER TABLE "PetitionSupport" DROP CONSTRAINT "PetitionSupport_petitionId_fkey";

-- AlterTable
ALTER TABLE "Petition" ALTER COLUMN "createdByMembershipId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Petition" ADD CONSTRAINT "Petition_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "GroupMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetitionSupport" ADD CONSTRAINT "PetitionSupport_petitionId_fkey" FOREIGN KEY ("petitionId") REFERENCES "Petition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetitionSupport" ADD CONSTRAINT "PetitionSupport_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "GroupMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
