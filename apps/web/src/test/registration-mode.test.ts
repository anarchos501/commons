import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { proposeRegistrationModeChange } from "../lib/node-registration-mode";
import { addNodePetitionSupport } from "../lib/petitions";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import { createPrismaClient } from "../lib/prisma";

const prisma = createPrismaClient();
const prefix = `regmode_${randomUUID().slice(0, 6)}`;

test.after(async () => {
  await prisma.nodePetitionSupport.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.petition.deleteMany({ where: { scopeId: { startsWith: prefix } } });
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.$disconnect();
});

async function fixture() {
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: prefix, domain: `${prefix}.example` },
  });
  const account = await prisma.account.create({
    data: { id: `${prefix}_acct`, homeNodeId: node.id, displayName: "Mode Voter", accountType: "participant" },
  });
  const group = await prisma.group.create({
    data: { id: `${prefix}_grp`, nodeId: node.id, name: `${prefix} grp`, membershipPolicy: "open", visibility: "public" },
  });
  await prisma.groupMembership.create({
    data: { id: `${prefix}_mem`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
  });
  return { node, account };
}

test("registration mode defaults open, changes only by node-wide vote, and is legible", async () => {
  const { node, account } = await fixture();

  // Phase-0 default: ALL nodes open (the mode must never label a door that
  // doesn't exist — C0 flips the creation default with the gate itself).
  assert.equal(node.registrationMode, "open");

  const invalid = await proposeRegistrationModeChange(prisma, {
    nodeId: node.id,
    target: "bouncer_only",
    requestedByAccountId: account.id,
  });
  assert.deepEqual(invalid, { ok: false, reason: "invalid_mode" });

  const alreadySet = await proposeRegistrationModeChange(prisma, {
    nodeId: node.id,
    target: "open",
    requestedByAccountId: account.id,
  });
  assert.deepEqual(alreadySet, { ok: false, reason: "already_set" });

  const proposed = await proposeRegistrationModeChange(prisma, {
    nodeId: node.id,
    target: "invite_only",
    requestedByAccountId: account.id,
  });
  assert.equal(proposed.ok, true);
  if (!proposed.ok) return;

  // One at a time (competition key).
  const duplicate = await proposeRegistrationModeChange(prisma, {
    nodeId: node.id,
    target: "invite_only",
    requestedByAccountId: account.id,
  });
  assert.deepEqual(duplicate, { ok: false, reason: "petition_already_open" });

  assert.equal((await addNodePetitionSupport(prisma, { petitionId: proposed.petitionId, accountId: account.id })).ok, true);
  await prisma.petition.update({ where: { id: proposed.petitionId }, data: { closesAt: new Date(Date.now() - 1000) } });
  await evaluateAndApplyPetition(prisma, proposed.petitionId);

  const after = await prisma.node.findUniqueOrThrow({ where: { id: node.id } });
  assert.equal(after.registrationMode, "invite_only");
});
