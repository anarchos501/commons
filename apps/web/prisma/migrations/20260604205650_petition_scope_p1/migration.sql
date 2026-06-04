-- P1: Generalize petition participation for project-scoped governance.
-- scopeType/scopeId replace groupId as the governing-entity reference on Petition.
-- PetitionSupport.membershipId made nullable; projectMembershipId added for project-member support.
-- Partial unique indexes replace the dropped standard unique constraint on PetitionSupport.

-- DropIndex (replaced by partial unique indexes below)
DROP INDEX "PetitionSupport_petitionId_membershipId_key";

-- AlterTable Petition: add scopeType/scopeId, make groupId nullable, add project creator FK
ALTER TABLE "Petition"
  ADD COLUMN "scopeType" TEXT NOT NULL DEFAULT 'group',
  ADD COLUMN "scopeId"   TEXT,
  ADD COLUMN "createdByProjectMembershipId" TEXT,
  ALTER COLUMN "groupId" DROP NOT NULL;

-- Backfill scopeId from existing groupId (all existing petitions are group-scoped)
UPDATE "Petition" SET "scopeId" = "groupId" WHERE "scopeId" IS NULL;

-- Now enforce NOT NULL on scopeId
ALTER TABLE "Petition" ALTER COLUMN "scopeId" SET NOT NULL;

-- AlterTable PetitionSupport: make membershipId nullable, add project membership FK
ALTER TABLE "PetitionSupport"
  ADD COLUMN "projectMembershipId" TEXT,
  ALTER COLUMN "membershipId" DROP NOT NULL;

-- Indexes
CREATE INDEX "Petition_scopeType_scopeId_status_idx" ON "Petition"("scopeType", "scopeId", "status");

-- Foreign keys
ALTER TABLE "Petition"
  ADD CONSTRAINT "Petition_createdByProjectMembershipId_fkey"
  FOREIGN KEY ("createdByProjectMembershipId") REFERENCES "ProjectMembership"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PetitionSupport"
  ADD CONSTRAINT "PetitionSupport_projectMembershipId_fkey"
  FOREIGN KEY ("projectMembershipId") REFERENCES "ProjectMembership"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique indexes (replacing the dropped standard unique constraint).
-- Postgres NULL != NULL, so a standard UNIQUE on a nullable column allows multiple NULLs.
-- Partial indexes enforce uniqueness only where the column is non-null.
CREATE UNIQUE INDEX "petition_support_group_unique"
  ON "PetitionSupport" ("petitionId", "membershipId")
  WHERE "membershipId" IS NOT NULL;

CREATE UNIQUE INDEX "petition_support_project_unique"
  ON "PetitionSupport" ("petitionId", "projectMembershipId")
  WHERE "projectMembershipId" IS NOT NULL;
