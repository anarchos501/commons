ALTER TABLE "ContributionCategoryDraft"
  ADD COLUMN "proposedByProjectMembershipId" TEXT,
  ALTER COLUMN "proposedByMembershipId" DROP NOT NULL;

ALTER TABLE "ContributionCategoryDraft"
  ADD CONSTRAINT "ContributionCategoryDraft_proposedByProjectMembershipId_fkey"
  FOREIGN KEY ("proposedByProjectMembershipId") REFERENCES "ProjectMembership"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ContributionCategoryDraft_proposedByProjectMembershipId_idx"
  ON "ContributionCategoryDraft"("proposedByProjectMembershipId");
