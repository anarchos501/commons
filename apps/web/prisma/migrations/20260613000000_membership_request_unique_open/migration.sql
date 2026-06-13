-- Membership sponsorship created duplicate petitions when a member double-clicked
-- "Sponsor": there has been no uniqueness guard on open membership_request petitions since
-- the broad competitionKey index was dropped (20260603000400). Enforce one open
-- membership_request petition per applicant per group, mirroring
-- Petition_thread_close_open_unique.

-- 1. Resolve any pre-existing duplicates so the unique index can be created: keep the
--    earliest-opened open petition per (subjectId, groupId) and withdraw the rest.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY "subjectId", "groupId"
      ORDER BY "opensAt" ASC, id ASC
    ) AS rn
  FROM "Petition"
  WHERE "subjectType" = 'membership_request' AND "status" = 'open'
)
UPDATE "Petition" p
SET "status" = 'withdrawn', "resolvedAt" = now()
FROM ranked
WHERE p.id = ranked.id AND ranked.rn > 1;

-- 2. At most one open membership_request petition per applicant (subjectId) per group.
CREATE UNIQUE INDEX "Petition_membership_request_open_unique"
  ON "Petition"("subjectId", "groupId")
  WHERE "subjectType" = 'membership_request' AND "status" = 'open';
