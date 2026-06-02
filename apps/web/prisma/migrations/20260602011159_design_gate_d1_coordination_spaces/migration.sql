-- Design Gate D1: Coordination Spaces — Projects
--
-- Changes:
--   1. Replace ProjectStatus enum (active/paused/completed/archived →
--      active/quiet/dormant/completed/closed)
--   2. Add archivedAt and membershipPolicy columns to Project
--   3. Create ProjectHosting join table (multi-host support)
--   4. Create ProjectMembership model
--
-- Approved migration mapping:
--   active   → active
--   paused   → quiet
--   completed → completed
--   archived → dormant + archivedAt = NOW()

-- Step 1: Add archivedAt column first — needed before we set it for archived rows.
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Step 2: Add new enum values (PostgreSQL supports ADD VALUE without recreating the type).
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'quiet';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'dormant';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'closed';

-- Step 3: Migrate existing rows to new values BEFORE removing old values.
UPDATE "Project" SET "status" = 'quiet'
  WHERE "status" = 'paused';

UPDATE "Project" SET "status" = 'dormant', "archivedAt" = CURRENT_TIMESTAMP
  WHERE "status" = 'archived';

-- active and completed remain unchanged.

-- Step 4: Remove old enum values by recreating the type.
-- Must drop the column default first — PostgreSQL cannot auto-cast the default value.
ALTER TABLE "Project" ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "ProjectStatus_new" AS ENUM ('active', 'quiet', 'dormant', 'completed', 'closed');

ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus_new"
  USING ("status"::text::"ProjectStatus_new");

DROP TYPE "ProjectStatus";
ALTER TYPE "ProjectStatus_new" RENAME TO "ProjectStatus";

-- Restore the default after the type replacement.
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'active';

-- Step 5: Add membershipPolicy column and archivedAt index.
ALTER TABLE "Project" ADD COLUMN "membershipPolicy" TEXT NOT NULL DEFAULT 'petition';
CREATE INDEX "Project_archivedAt_idx" ON "Project"("archivedAt");

-- Step 6: Create ProjectHosting table.
CREATE TABLE "ProjectHosting" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "hostedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectHosting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectHosting_projectId_groupId_key" ON "ProjectHosting"("projectId", "groupId");
CREATE INDEX "ProjectHosting_projectId_idx" ON "ProjectHosting"("projectId");
CREATE INDEX "ProjectHosting_groupId_idx" ON "ProjectHosting"("groupId");

ALTER TABLE "ProjectHosting" ADD CONSTRAINT "ProjectHosting_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectHosting" ADD CONSTRAINT "ProjectHosting_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Populate ProjectHosting from existing Project.groupId (one hosting row per project).
INSERT INTO "ProjectHosting" ("id", "projectId", "groupId", "hostedAt")
SELECT gen_random_uuid(), "id", "groupId", "createdAt"
FROM "Project";

-- Step 7: Create ProjectMembership table.
CREATE TABLE "ProjectMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "participationStatus" "ParticipationStatus" NOT NULL DEFAULT 'active',
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "ProjectMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectMembership_accountId_projectId_key" ON "ProjectMembership"("accountId", "projectId");
CREATE INDEX "ProjectMembership_accountId_idx" ON "ProjectMembership"("accountId");
CREATE INDEX "ProjectMembership_projectId_idx" ON "ProjectMembership"("projectId");
CREATE INDEX "ProjectMembership_projectId_participationStatus_idx" ON "ProjectMembership"("projectId", "participationStatus");

ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
