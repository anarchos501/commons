-- The previous migration created a unique index on competitionKey for all open petitions,
-- which incorrectly blocks competing petitions (e.g. multiple living_document_revision
-- proposals for the same document). Replace it with a targeted constraint that only
-- enforces uniqueness for discussion_thread_close, where exactly one open petition
-- per thread is the correct invariant.
DROP INDEX IF EXISTS "Petition_competitionKey_open_unique";

CREATE UNIQUE INDEX "Petition_thread_close_open_unique"
  ON "Petition"("subjectId", "groupId")
  WHERE "subjectType" = 'discussion_thread_close' AND "status" = 'open';
