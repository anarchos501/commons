-- RFC-007 Phase 1: Multi-Host Project Governance
--
-- Project.groupId is renamed to foundingGroupId: it remains required, immutable
-- provenance ("which group founded this project") and confers no current-hosting
-- authority. Current hosting is determined solely by active ProjectHosting rows
-- (see governance-ownership.ts). The rename is a plain column rename so existing
-- data and constraints carry forward unchanged; only the names are updated to match.

ALTER TABLE "Project" RENAME COLUMN "groupId" TO "foundingGroupId";
ALTER TABLE "Project" RENAME CONSTRAINT "Project_groupId_fkey" TO "Project_foundingGroupId_fkey";
ALTER INDEX "Project_groupId_idx" RENAME TO "Project_foundingGroupId_idx";
ALTER INDEX "Project_groupId_name_key" RENAME TO "Project_foundingGroupId_name_key";

-- Opens a 30-day adoption grace period when a non-completed project loses its last
-- active host (see project-membership.ts pending-closure lifecycle).
ALTER TABLE "Project" ADD COLUMN "pendingClosureAt" TIMESTAMP(3);

-- ProjectHosting becomes a history of hosting periods rather than a point-in-time
-- membership table: endedAt IS NULL marks an active hosting relationship, and a
-- withdrawal sets endedAt rather than deleting the row, so history survives a group
-- hosting (and later un-hosting and re-hosting) the same project over time.
ALTER TABLE "ProjectHosting" ADD COLUMN "endedAt" TIMESTAMP(3);

-- The old always-on unique constraint would either block re-hosting after a withdrawal
-- (the historical row still occupies the [projectId, groupId] pair) or require deleting
-- history to allow it. Replace it with a partial index that only enforces uniqueness
-- among currently-active hosting rows; any number of ended (historical) rows may exist
-- for the same pair. Prisma cannot express a WHERE-conditioned @@unique natively, so
-- this constraint is hand-written (same approach as Petition_thread_close_open_unique
-- in 20260603000400_fix_petition_duplicate_constraint).
DROP INDEX "ProjectHosting_projectId_groupId_key";
CREATE UNIQUE INDEX "ProjectHosting_active_unique" ON "ProjectHosting"("projectId", "groupId") WHERE "endedAt" IS NULL;
CREATE INDEX "ProjectHosting_endedAt_idx" ON "ProjectHosting"("endedAt");

-- ProjectHostingProposal: the mutual-consent bundle that links a candidate group's
-- internal "should we host this project?" petition with a pending-closure project's
-- internal "should we accept this host?" petition. Both petitions must succeed for
-- ProjectHosting to be created; rejection, withdrawal, or timeout on either side fails
-- the whole proposal and supersedes the other still-open petition (same orchestration
-- shape Phase 2 will reuse for CoalitionProposal).
CREATE TABLE "ProjectHostingProposal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "candidateGroupId" TEXT NOT NULL,
    "projectSnapshot" JSONB NOT NULL,
    "candidateGroupSnapshot" JSONB NOT NULL,
    "frozenElectorate" JSONB NOT NULL,
    "content" TEXT NOT NULL,
    "groupPetitionId" TEXT NOT NULL,
    "projectPetitionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectHostingProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectHostingProposal_projectId_idx" ON "ProjectHostingProposal"("projectId");
CREATE INDEX "ProjectHostingProposal_candidateGroupId_idx" ON "ProjectHostingProposal"("candidateGroupId");
CREATE INDEX "ProjectHostingProposal_groupPetitionId_idx" ON "ProjectHostingProposal"("groupPetitionId");
CREATE INDEX "ProjectHostingProposal_projectPetitionId_idx" ON "ProjectHostingProposal"("projectPetitionId");
CREATE INDEX "ProjectHostingProposal_status_idx" ON "ProjectHostingProposal"("status");

ALTER TABLE "ProjectHostingProposal" ADD CONSTRAINT "ProjectHostingProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectHostingProposal" ADD CONSTRAINT "ProjectHostingProposal_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
