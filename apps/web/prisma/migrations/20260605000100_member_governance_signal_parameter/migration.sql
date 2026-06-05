ALTER TABLE "MemberGovernanceSignal" ADD COLUMN "parameter" TEXT NOT NULL DEFAULT '_';

DROP INDEX "MemberGovernanceSignal_membershipId_category_key";

CREATE UNIQUE INDEX "MemberGovernanceSignal_membershipId_category_parameter_key"
  ON "MemberGovernanceSignal"("membershipId", "category", "parameter");
