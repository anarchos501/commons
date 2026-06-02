-- CreateTable
CREATE TABLE "EmergencyPeriod" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "petitionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedByPetitionId" TEXT,

    CONSTRAINT "EmergencyPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmergencyPeriod_groupId_idx" ON "EmergencyPeriod"("groupId");

-- CreateIndex
CREATE INDEX "EmergencyPeriod_expiresAt_idx" ON "EmergencyPeriod"("expiresAt");

-- AddForeignKey
ALTER TABLE "EmergencyPeriod" ADD CONSTRAINT "EmergencyPeriod_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
