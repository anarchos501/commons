-- CreateEnum
CREATE TYPE "RequestRouteStatus" AS ENUM ('notified', 'accepted', 'declined', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "RequestRoute" (
    "id" TEXT NOT NULL,
    "supportRequestId" TEXT NOT NULL,
    "contributorAccountId" TEXT NOT NULL,
    "serviceCapabilityId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "trustRequirement" "TrustRequirement" NOT NULL DEFAULT 'lightweight',
    "status" "RequestRouteStatus" NOT NULL DEFAULT 'notified',
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributorAvailability" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "serviceCapabilityId" TEXT,
    "serviceType" TEXT NOT NULL,
    "availability" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributorAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestRoute_supportRequestId_idx" ON "RequestRoute"("supportRequestId");

-- CreateIndex
CREATE INDEX "RequestRoute_contributorAccountId_idx" ON "RequestRoute"("contributorAccountId");

-- CreateIndex
CREATE INDEX "RequestRoute_serviceCapabilityId_idx" ON "RequestRoute"("serviceCapabilityId");

-- CreateIndex
CREATE INDEX "RequestRoute_serviceType_idx" ON "RequestRoute"("serviceType");

-- CreateIndex
CREATE INDEX "RequestRoute_trustRequirement_idx" ON "RequestRoute"("trustRequirement");

-- CreateIndex
CREATE INDEX "RequestRoute_status_idx" ON "RequestRoute"("status");

-- CreateIndex
CREATE INDEX "RequestRoute_createdAt_idx" ON "RequestRoute"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequestRoute_supportRequestId_contributorAccountId_serviceT_key" ON "RequestRoute"("supportRequestId", "contributorAccountId", "serviceType", "trustRequirement");

-- CreateIndex
CREATE INDEX "ContributorAvailability_accountId_idx" ON "ContributorAvailability"("accountId");

-- CreateIndex
CREATE INDEX "ContributorAvailability_serviceCapabilityId_idx" ON "ContributorAvailability"("serviceCapabilityId");

-- CreateIndex
CREATE INDEX "ContributorAvailability_serviceType_idx" ON "ContributorAvailability"("serviceType");

-- CreateIndex
CREATE INDEX "ContributorAvailability_active_idx" ON "ContributorAvailability"("active");

-- CreateIndex
CREATE UNIQUE INDEX "ContributorAvailability_accountId_serviceType_key" ON "ContributorAvailability"("accountId", "serviceType");

-- AddForeignKey
ALTER TABLE "RequestRoute" ADD CONSTRAINT "RequestRoute_supportRequestId_fkey" FOREIGN KEY ("supportRequestId") REFERENCES "SupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestRoute" ADD CONSTRAINT "RequestRoute_contributorAccountId_fkey" FOREIGN KEY ("contributorAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestRoute" ADD CONSTRAINT "RequestRoute_serviceCapabilityId_fkey" FOREIGN KEY ("serviceCapabilityId") REFERENCES "ServiceCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorAvailability" ADD CONSTRAINT "ContributorAvailability_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorAvailability" ADD CONSTRAINT "ContributorAvailability_serviceCapabilityId_fkey" FOREIGN KEY ("serviceCapabilityId") REFERENCES "ServiceCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
