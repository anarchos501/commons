-- Feedback #2: transitioning a group between open and application-based membership is now a
-- petition. Enforce that at most one open membership_policy_change petition exists per group at
-- a time (target-independent index on groupId), mirroring Petition_thread_close_open_unique.
-- membership_policy_change is a brand-new subjectType, so there are no pre-existing rows to dedupe.
CREATE UNIQUE INDEX "Petition_membership_policy_change_open_unique"
  ON "Petition"("groupId")
  WHERE "subjectType" = 'membership_policy_change' AND "status" = 'open';
