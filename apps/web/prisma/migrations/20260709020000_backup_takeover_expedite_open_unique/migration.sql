-- F3.5 Phase 4: one open expedite petition per replica (register F-7 —
-- single-open invariants are DB partial unique indexes, never competition
-- keys, because competition keys collapse at resolution, not at open).
CREATE UNIQUE INDEX "Petition_backup_takeover_expedite_open_unique"
  ON "Petition" ("subjectId")
  WHERE "subjectType" = 'backup_takeover_expedite' AND "status" = 'open';
