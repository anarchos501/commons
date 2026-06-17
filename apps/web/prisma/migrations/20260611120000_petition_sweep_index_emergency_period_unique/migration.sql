-- Add sweep index: allows efficient querying of open petitions past their closesAt
CREATE INDEX "Petition_status_closesAt_idx" ON "Petition"("status", "closesAt");

-- Add uniqueness guard: at most one EmergencyPeriod per petition
-- NULL petitionId is allowed (for declareTempStewardship periods with no petition)
CREATE UNIQUE INDEX "EmergencyPeriod_petitionId_key" ON "EmergencyPeriod"("petitionId");
