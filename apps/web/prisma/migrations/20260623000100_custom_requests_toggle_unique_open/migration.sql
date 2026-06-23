-- Feedback #1: accepting/declining custom support requests is now a collective petition.
-- Enforce at the DB level that at most one open custom_support_requests_toggle petition
-- exists per group at a time, mirroring Petition_thread_close_open_unique. The index is on
-- groupId only (target-independent) so an "accept" and a "stop" proposal can't both be open.
-- custom_support_requests_toggle is a brand-new subjectType, so no pre-existing rows to dedupe.
CREATE UNIQUE INDEX "Petition_custom_requests_toggle_open_unique"
  ON "Petition"("groupId")
  WHERE "subjectType" = 'custom_support_requests_toggle' AND "status" = 'open';
