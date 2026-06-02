-- DropForeignKey
ALTER TABLE "EmergencyPeriod" DROP CONSTRAINT "EmergencyPeriod_groupId_fkey";

-- DropForeignKey
ALTER TABLE "MemberGovernanceSignal" DROP CONSTRAINT "MemberGovernanceSignal_groupId_fkey";

-- DropForeignKey
ALTER TABLE "MemberGovernanceSignal" DROP CONSTRAINT "MemberGovernanceSignal_membershipId_fkey";

-- DropForeignKey
ALTER TABLE "Petition" DROP CONSTRAINT "Petition_groupId_fkey";

-- AddForeignKey
ALTER TABLE "MemberGovernanceSignal" ADD CONSTRAINT "MemberGovernanceSignal_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "GroupMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberGovernanceSignal" ADD CONSTRAINT "MemberGovernanceSignal_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPeriod" ADD CONSTRAINT "EmergencyPeriod_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Petition" ADD CONSTRAINT "Petition_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
