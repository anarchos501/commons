-- Enforce at DB level that only one open petition can exist per competition key.
-- This closes the TOCTOU race where two concurrent requests could both pass the
-- application-level findFirst check before either creates a petition.
CREATE UNIQUE INDEX "Petition_competitionKey_open_unique" ON "Petition"("competitionKey") WHERE "status" = 'open' AND "competitionKey" IS NOT NULL;
