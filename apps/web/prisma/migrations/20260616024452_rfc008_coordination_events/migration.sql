-- CreateEnum
CREATE TYPE "EventHostType" AS ENUM ('group', 'project', 'responsibility', 'coalition', 'account');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('meeting', 'workshop');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('host_only', 'audience', 'public');

-- CreateEnum
CREATE TYPE "EventInterestLevel" AS ENUM ('planning_to_attend', 'interested');

-- NOTE: The following two statements are pre-existing schema/migration drift
-- (unrelated to RFC-008) that Prisma's diff bundled into this migration. They
-- bring the migration history in line with the committed schema and are benign.
-- DropForeignKey
ALTER TABLE "CoalitionProposal" DROP CONSTRAINT "CoalitionProposal_coalitionId_fkey";

-- AlterTable
ALTER TABLE "NodeStewardProposal" ALTER COLUMN "baselineStewardRevision" DROP DEFAULT;

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "category" "EventCategory" NOT NULL,
    "hostType" "EventHostType" NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "location" TEXT,
    "visibility" "EventVisibility" NOT NULL DEFAULT 'host_only',
    "createdByAccountId" TEXT NOT NULL,
    "authorizingPetitionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "canceledByAccountId" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAudience" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "audienceType" "EventHostType" NOT NULL,
    "audienceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventInterest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "level" "EventInterestLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarFilterPreference" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "showGroupEvents" BOOLEAN NOT NULL DEFAULT true,
    "showProjectEvents" BOOLEAN NOT NULL DEFAULT true,
    "showResponsibilityEvents" BOOLEAN NOT NULL DEFAULT true,
    "showCoalitionEvents" BOOLEAN NOT NULL DEFAULT true,
    "showPersonalEvents" BOOLEAN NOT NULL DEFAULT true,
    "spaceFilters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarFilterPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventProposal" (
    "id" TEXT NOT NULL,
    "category" "EventCategory" NOT NULL,
    "hostType" "EventHostType" NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "location" TEXT,
    "visibility" "EventVisibility" NOT NULL DEFAULT 'host_only',
    "audienceJson" JSONB NOT NULL,
    "proposedByAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "participantSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdEventId" TEXT,

    CONSTRAINT "EventProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventProposalPetition" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "petitionId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventProposalPetition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_hostType_hostId_idx" ON "CalendarEvent"("hostType", "hostId");

-- CreateIndex
CREATE INDEX "CalendarEvent_startTime_idx" ON "CalendarEvent"("startTime");

-- CreateIndex
CREATE INDEX "CalendarEvent_canceledAt_idx" ON "CalendarEvent"("canceledAt");

-- CreateIndex
CREATE INDEX "EventAudience_audienceType_audienceId_idx" ON "EventAudience"("audienceType", "audienceId");

-- CreateIndex
CREATE UNIQUE INDEX "EventAudience_eventId_audienceType_audienceId_key" ON "EventAudience"("eventId", "audienceType", "audienceId");

-- CreateIndex
CREATE INDEX "EventInterest_eventId_level_idx" ON "EventInterest"("eventId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "EventInterest_eventId_accountId_key" ON "EventInterest"("eventId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFilterPreference_accountId_key" ON "CalendarFilterPreference"("accountId");

-- CreateIndex
CREATE INDEX "EventProposal_hostType_hostId_idx" ON "EventProposal"("hostType", "hostId");

-- CreateIndex
CREATE INDEX "EventProposal_status_idx" ON "EventProposal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EventProposalPetition_petitionId_key" ON "EventProposalPetition"("petitionId");

-- CreateIndex
CREATE INDEX "EventProposalPetition_proposalId_idx" ON "EventProposalPetition"("proposalId");

-- AddForeignKey
ALTER TABLE "CoalitionProposal" ADD CONSTRAINT "CoalitionProposal_coalitionId_fkey" FOREIGN KEY ("coalitionId") REFERENCES "Coalition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAudience" ADD CONSTRAINT "EventAudience_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInterest" ADD CONSTRAINT "EventInterest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInterest" ADD CONSTRAINT "EventInterest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarFilterPreference" ADD CONSTRAINT "CalendarFilterPreference_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventProposalPetition" ADD CONSTRAINT "EventProposalPetition_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "EventProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RFC-008: defense-in-depth — an event must end after it starts (service also validates).
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "calendar_event_time_order" CHECK ("endTime" > "startTime");
