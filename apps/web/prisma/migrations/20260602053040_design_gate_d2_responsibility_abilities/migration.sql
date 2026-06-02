-- CreateEnum
CREATE TYPE "CoordinationAbility" AS ENUM ('create_bulletins', 'create_publications', 'create_publication_entries', 'create_projects', 'issue_support_requests', 'issue_contribution_offers', 'approve_membership', 'review_concerns', 'issue_findings', 'issue_action_proposals', 'administrative_closure');

-- CreateEnum
CREATE TYPE "AbilityAvailability" AS ENUM ('always_available', 'available_during_emergency');

-- CreateTable
CREATE TABLE "ResponsibilityAbility" (
    "id" TEXT NOT NULL,
    "responsibilityId" TEXT NOT NULL,
    "ability" "CoordinationAbility" NOT NULL,
    "availability" "AbilityAvailability" NOT NULL DEFAULT 'always_available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResponsibilityAbility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResponsibilityAbility_responsibilityId_idx" ON "ResponsibilityAbility"("responsibilityId");

-- CreateIndex
CREATE UNIQUE INDEX "ResponsibilityAbility_responsibilityId_ability_key" ON "ResponsibilityAbility"("responsibilityId", "ability");

-- AddForeignKey
ALTER TABLE "ResponsibilityAbility" ADD CONSTRAINT "ResponsibilityAbility_responsibilityId_fkey" FOREIGN KEY ("responsibilityId") REFERENCES "Responsibility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
