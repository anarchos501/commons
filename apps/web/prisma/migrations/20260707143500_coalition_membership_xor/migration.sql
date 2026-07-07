-- register D-4/A4: a coalition member is EITHER a local group or a remote
-- presence — exactly one, structurally impossible to violate ("by
-- construction, not by discipline"). Neither-set and both-set are the
-- corruption cases this forbids.
ALTER TABLE "CoalitionMembership" ADD CONSTRAINT "CoalitionMembership_member_xor"
  CHECK (("groupId" IS NOT NULL AND "federatedGroupPresenceId" IS NULL)
      OR ("groupId" IS NULL AND "federatedGroupPresenceId" IS NOT NULL));
