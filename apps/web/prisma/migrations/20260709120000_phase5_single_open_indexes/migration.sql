-- F3.5 Phase 5 (register F-7 discipline): single-open invariants are DB
-- partial unique indexes, never propose-time checks alone.
-- One open backup-designation proposal per coalition:
CREATE UNIQUE INDEX "CoalitionProposal_backup_designation_open_unique"
  ON "CoalitionProposal" ("coalitionId")
  WHERE "action" = 'backup_designation' AND "status" = 'open';
-- One open consent-withdrawal petition per (group, coalition):
CREATE UNIQUE INDEX "Petition_coalition_backup_revocation_open_unique"
  ON "Petition" ("groupId", "subjectId")
  WHERE "subjectType" = 'coalition_backup_revocation' AND "status" = 'open';
