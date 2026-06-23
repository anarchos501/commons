-- Feedback #8: a member could open two confirmation petitions for the same volunteer role
-- because responsibility_proposal has no competition key and (since 20260603000400 dropped the
-- broad competitionKey index) no uniqueness guard. Enforce one open petition per (subjectId,
-- groupId) — i.e. per (membership, role) — mirroring Petition_membership_request_open_unique.
-- subjectId encodes "{membershipId}:{type}", so this only collides for the same member + role;
-- different members may still volunteer for the same role (multi-holder by design).

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
  WHERE "subjectType" = 'responsibility_proposal' AND "status" = 'open'
)
UPDATE "Petition" p
SET "status" = 'withdrawn', "resolvedAt" = now()
FROM ranked
WHERE p.id = ranked.id AND ranked.rn > 1;

-- 2. At most one open responsibility_proposal petition per (membership, role) per group.
CREATE UNIQUE INDEX "Petition_responsibility_volunteer_open_unique"
  ON "Petition"("subjectId", "groupId")
  WHERE "subjectType" = 'responsibility_proposal' AND "status" = 'open';
