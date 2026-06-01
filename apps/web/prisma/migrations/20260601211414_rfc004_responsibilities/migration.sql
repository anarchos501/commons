-- RFC-004: Responsibilities, Recall, and Coverage
-- Replaces the Role model with Responsibility + ResponsibilityAssignment.
--
-- Migration order:
--   1. Create new enum and tables
--   2. Migrate existing Role data (reviewer + coordinator → reviewer assignments)
--   3. Drop old Role table and RoleRecallPolicy enum

-- Step 1: Create new enum and tables

-- CreateEnum
CREATE TYPE "AssignmentEndReason" AS ENUM ('expired', 'quiet', 'dormant', 'recall', 'resigned');

-- CreateTable
CREATE TABLE "Responsibility" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "termDays" INTEGER NOT NULL DEFAULT 365,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Responsibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponsibilityAssignment" (
    "id" TEXT NOT NULL,
    "responsibilityId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" "AssignmentEndReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResponsibilityAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Responsibility_groupId_idx" ON "Responsibility"("groupId");

-- CreateIndex
CREATE INDEX "Responsibility_type_idx" ON "Responsibility"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Responsibility_groupId_type_key" ON "Responsibility"("groupId", "type");

-- CreateIndex
CREATE INDEX "ResponsibilityAssignment_responsibilityId_idx" ON "ResponsibilityAssignment"("responsibilityId");

-- CreateIndex
CREATE INDEX "ResponsibilityAssignment_membershipId_idx" ON "ResponsibilityAssignment"("membershipId");

-- CreateIndex
CREATE INDEX "ResponsibilityAssignment_expiresAt_idx" ON "ResponsibilityAssignment"("expiresAt");

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityAssignment" ADD CONSTRAINT "ResponsibilityAssignment_responsibilityId_fkey" FOREIGN KEY ("responsibilityId") REFERENCES "Responsibility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityAssignment" ADD CONSTRAINT "ResponsibilityAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "GroupMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 2: Migrate existing Role data
-- roleType = "reviewer"   → Responsibility.type = "reviewer" + ResponsibilityAssignment
-- roleType = "coordinator" → migrated to reviewer (coordinator existed only to gate
--                             administrative closure, which RFC-004 moves under reviewer)
-- all other roleType values → dropped (no migration)

INSERT INTO "Responsibility" ("id", "groupId", "type", "termDays", "createdAt")
SELECT
  gen_random_uuid(),
  r."groupId",
  'reviewer',
  365,
  NOW()
FROM "Role" r
WHERE r."roleType" IN ('reviewer', 'coordinator')
  AND r."groupId" IS NOT NULL
ON CONFLICT ("groupId", "type") DO NOTHING;

INSERT INTO "ResponsibilityAssignment" ("id", "responsibilityId", "membershipId", "startedAt", "expiresAt", "createdAt")
SELECT DISTINCT ON (m."id", resp."id")
  gen_random_uuid(),
  resp."id",
  m."id",
  r."startsAt",
  r."expiresAt",
  r."createdAt"
FROM "Role" r
JOIN "Responsibility" resp
  ON resp."groupId" = r."groupId" AND resp."type" = 'reviewer'
JOIN "GroupMembership" m
  ON m."accountId" = r."accountId" AND m."groupId" = r."groupId"
WHERE r."roleType" IN ('reviewer', 'coordinator')
  AND r."groupId" IS NOT NULL
ORDER BY m."id", resp."id", r."expiresAt" DESC;

-- Step 3: Drop old Role table and enum

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_groupId_fkey";

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_projectId_fkey";

-- DropTable
DROP TABLE "Role";

-- DropEnum
DROP TYPE "RoleRecallPolicy";
