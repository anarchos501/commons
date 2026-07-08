-- register F-7: single-open invariants are DB constraints, never app checks.
-- One open registration-mode vote per node at a time.
CREATE UNIQUE INDEX "Petition_registration_mode_change_open_unique"
  ON "Petition"("scopeId")
  WHERE "subjectType" = 'registration_mode_change' AND "status" = 'open';
