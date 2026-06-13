import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import { listNodeGroupLabelsForAccount } from "../lib/node-privacy";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

const PREFIX = "np_test";

async function cleanup() {
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: PREFIX } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: PREFIX } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

// The coalition propose/invite forms build their candidate list as
//   listNodeGroupLabelsForAccount(...).filter((g) => !g.isPrivate)
// so this exercises exactly the data + predicate those forms rely on.
test("coalition candidate filtering: private non-member groups are excluded, public and member-of-private are kept", async () => {
  await cleanup();
  try {
    const node = await prisma.node.create({
      data: { id: `${PREFIX}_node`, name: "NP Node", domain: `${PREFIX}.cc.localhost`, federationPolicy: "disabled", pluginPolicy: "disabled" },
    });
    const actor = await prisma.account.create({
      data: { id: `${PREFIX}_actor`, homeNodeId: node.id, displayName: "Actor", accountType: "member", profileVisibility: "private" },
    });
    const publicGroup = await prisma.group.create({
      data: { id: `${PREFIX}_pub`, nodeId: node.id, name: "Public Group", membershipPolicy: "open", visibility: "public" },
    });
    const otherPrivate = await prisma.group.create({
      data: { id: `${PREFIX}_priv_other`, nodeId: node.id, name: "Other Private Group", membershipPolicy: "request_required", visibility: "private" },
    });
    const myPrivate = await prisma.group.create({
      data: { id: `${PREFIX}_priv_mine`, nodeId: node.id, name: "My Private Group", membershipPolicy: "request_required", visibility: "private" },
    });
    // Actor is an active member of only the "mine" private group.
    await prisma.groupMembership.create({
      data: { id: `${PREFIX}_mem`, accountId: actor.id, groupId: myPrivate.id, status: "active", participationStatus: "active" },
    });

    const labels = await listNodeGroupLabelsForAccount(prisma, node.id, actor.id);
    const byId = new Map(labels.map((l) => [l.id, l]));

    // Public group: visible, not private.
    assert.equal(byId.get(publicGroup.id)?.isPrivate, false);
    assert.equal(byId.get(publicGroup.id)?.label, "Public Group");
    // Private group the actor is NOT in: marked private and label obscured.
    assert.equal(byId.get(otherPrivate.id)?.isPrivate, true);
    assert.ok(!byId.get(otherPrivate.id)?.label.includes("Other Private Group"));
    // Private group the actor IS in: visible (enables the shared-member bridge).
    assert.equal(byId.get(myPrivate.id)?.isPrivate, false);
    assert.equal(byId.get(myPrivate.id)?.label, "My Private Group");

    // The coalition candidate filter the forms apply.
    const candidates = labels.filter((g) => !g.isPrivate).map((g) => g.id);
    assert.ok(candidates.includes(publicGroup.id), "public group should be offered");
    assert.ok(candidates.includes(myPrivate.id), "member-of private group should be offered");
    assert.ok(!candidates.includes(otherPrivate.id), "non-member private group must NOT be offered");
  } finally {
    await cleanup();
  }
});
