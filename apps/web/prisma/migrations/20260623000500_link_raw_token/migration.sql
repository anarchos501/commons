-- Feedback #2: re-copyable shareable links. Persist the raw token so any active member can
-- re-copy the full link (not just an 8-char preview). Additive nullable columns — no backfill,
-- no change to existing rows; pre-migration links have NULL and degrade to preview-only.
-- Acceptable because these are shareable bearer links meant to be distributed (revocation is
-- the kill switch); this does NOT generalize to secrets that must never be stored raw.
ALTER TABLE "GroupInviteToken" ADD COLUMN "rawToken" TEXT;
ALTER TABLE "GroupRequestLink" ADD COLUMN "rawToken" TEXT;
