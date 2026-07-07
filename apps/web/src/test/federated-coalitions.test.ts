import "dotenv/config";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { openCoalitionFormationProposal } from "../lib/coalitions";
import { postFederatedCoalitionMessage } from "../lib/federated-coalitions";
import { establishPresence } from "../lib/federation-presence";
import { evaluateAndApplyPetition } from "../lib/petition-evaluation";
import { createPrismaClient } from "../lib/prisma";
import {
  approveStewardPetition,
  cleanupSide,
  createFederatedTriad,
  ensureSecondDatabase,
  ensureThirdDatabase,
  type FederatedTriad,
  type Side,
} from "./federation-fixtures";

// Cross-node coalitions over THREE real databases: A is the coalition's home,
// B and C are member nodes holding presences — and B and C hold NO pin of
// each other, so anything crossing B→C proves the hub relay (A4).

let prismaA: PrismaClient;
let prismaB: PrismaClient;
let prismaC: PrismaClient;

before(async () => {
  const [secondUrl, thirdUrl] = [await ensureSecondDatabase(), await ensureThirdDatabase()];
  prismaA = createPrismaClient();
  prismaB = createPrismaClient(secondUrl);
  prismaC = createPrismaClient(thirdUrl);
});

after(async () => {
  await prismaA?.$disconnect();
  await prismaB?.$disconnect();
  await prismaC?.$disconnect();
});

async function cleanupTriad(prefix: string) {
  await cleanupSide(prismaA, prefix);
  await cleanupSide(prismaB, prefix);
  await cleanupSide(prismaC, prefix);
}

async function memberSidePetition(side: Side, proposalId: string): Promise<string> {
  const link = await side.prisma.coalitionProposalPetition.findFirstOrThrow({
    where: { proposalId, groupId: side.groupId! },
    select: { petitionId: true },
  });
  return link.petitionId;
}

// Opens a formation on A with A's group + remote groups on B and C, and
// returns the proposal/petition ids.
async function openTriadFormation(triad: FederatedTriad, name: string) {
  const opened = await openCoalitionFormationProposal(prismaA, {
    name,
    content: "Three communities, one watershed.",
    participants: [{ groupId: triad.a.groupId!, createdByMembershipId: triad.a.stewardMembershipId! }],
    remoteParticipants: [
      { domain: triad.b.domain, remoteGroupId: triad.b.groupId!, name: "B collective" },
      { domain: triad.c.domain, remoteGroupId: triad.c.groupId!, name: "C collective" },
    ],
  });
  assert.equal(opened.ok, true, `formation open failed: ${JSON.stringify(opened)}`);
  if (!opened.ok) throw new Error("unreachable");
  return opened;
}

async function formTriadCoalition(triad: FederatedTriad, name: string): Promise<{ coalitionId: string }> {
  const opened = await openTriadFormation(triad, name);
  await triad.pump();
  await approveStewardPetition(triad.b, await memberSidePetition(triad.b, opened.proposalId));
  await approveStewardPetition(triad.c, await memberSidePetition(triad.c, opened.proposalId));
  await triad.pump();
  await approveStewardPetition(triad.a, opened.petitionIds[0]);
  await triad.pump();
  const coalition = await prismaA.coalition.findFirstOrThrow({ where: { name } });
  return { coalitionId: coalition.id };
}

test("XOR is structural: neither-set and both-set membership rows are impossible", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "fc_xor");
  try {
    const coalition = await prismaA.coalition.create({
      data: { nodeId: triad.a.node.id, name: "fc_xor probe" },
    });
    // Neither set:
    await assert.rejects(
      prismaA.coalitionMembership.create({ data: { coalitionId: coalition.id } }),
      /member_xor|constraint/i,
    );
    // Both set:
    const peer = await prismaA.federatedNode.findFirstOrThrow({ where: { domain: triad.b.domain } });
    const presence = await prismaA.federatedGroupPresence.create({
      data: { federatedNodeId: peer.id, remoteGroupId: "fc_xor_remote", name: "probe" },
    });
    await assert.rejects(
      prismaA.coalitionMembership.create({
        data: { coalitionId: coalition.id, groupId: triad.a.groupId!, federatedGroupPresenceId: presence.id },
      }),
      /member_xor|constraint/i,
    );
  } finally {
    await cleanupTriad("fc_xor");
  }
});

test("cross-node formation: three groups on three nodes converge on one coalition", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "fc_form");
  try {
    const opened = await openTriadFormation(triad, "Watershed Triad");
    await triad.pump();

    // Mirrors + system petitions exist on B and C.
    for (const side of [triad.b, triad.c]) {
      const mirror = await side.prisma.coalitionProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
      assert.equal(mirror.homeNodeDomain, triad.a.domain);
      assert.ok(await memberSidePetition(side, opened.proposalId));
    }

    // B approves; A cannot form yet (C pending).
    await approveStewardPetition(triad.b, await memberSidePetition(triad.b, opened.proposalId));
    await triad.pump();
    await approveStewardPetition(triad.a, opened.petitionIds[0]);
    await triad.pump();
    assert.equal(await prismaA.coalition.count({ where: { name: "Watershed Triad" } }), 0);

    // C approves: unanimity → the coalition forms on A with XOR memberships.
    await approveStewardPetition(triad.c, await memberSidePetition(triad.c, opened.proposalId));
    await triad.pump();

    const coalition = await prismaA.coalition.findFirstOrThrow({
      where: { name: "Watershed Triad", status: "active" },
      include: { memberships: { include: { federatedGroupPresence: true } } },
    });
    const local = coalition.memberships.filter((membership) => membership.groupId !== null);
    const remote = coalition.memberships.filter((membership) => membership.federatedGroupPresenceId !== null);
    assert.equal(local.length, 1);
    assert.equal(remote.length, 2);
    assert.deepEqual(
      remote.map((membership) => membership.federatedGroupPresence!.name).sort(),
      ["B collective", "C collective"],
    );

    // Member sides finalized: presence rows pointing home to A.
    for (const side of [triad.b, triad.c]) {
      const presence = await side.prisma.federatedCoalitionPresence.findFirstOrThrow({
        where: { coalitionId: coalition.id, groupId: side.groupId! },
        include: { homeFederatedNode: { select: { domain: true } } },
      });
      assert.equal(presence.status, "active");
      assert.equal(presence.homeFederatedNode.domain, triad.a.domain);
      const mirror = await side.prisma.coalitionProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
      assert.equal(mirror.status, "succeeded");
    }
  } finally {
    await cleanupTriad("fc_form");
  }
});

test("one member node's rejection fails the formation everywhere", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "fc_reject");
  try {
    const opened = await openTriadFormation(triad, "Doomed Triad");
    await triad.pump();

    // B rejects (petition closes unapproved); C approves.
    const petitionB = await memberSidePetition(triad.b, opened.proposalId);
    await prismaB.petition.update({ where: { id: petitionB }, data: { closesAt: new Date(Date.now() - 1000) } });
    await evaluateAndApplyPetition(prismaB, petitionB);
    await approveStewardPetition(triad.c, await memberSidePetition(triad.c, opened.proposalId));
    await triad.pump();

    const onA = await prismaA.coalitionProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(onA.status, "failed-rejected");
    assert.equal(await prismaA.coalition.count({ where: { name: "Doomed Triad" } }), 0);
    // C's mirror is finalized by the home's resolved broadcast; its open
    // petition — already approved here — stays approved, but the proposal is
    // terminal and no presence exists.
    const onC = await prismaC.coalitionProposal.findUniqueOrThrow({ where: { id: opened.proposalId } });
    assert.equal(onC.status, "failed-rejected");
    assert.equal(await prismaC.federatedCoalitionPresence.count({ where: { groupId: triad.c.groupId! } }), 0);
  } finally {
    await cleanupTriad("fc_reject");
  }
});

test("HUB RELAY (A4): content from B reaches C via A, with no B↔C relationship", async () => {
  const triad = await createFederatedTriad(prismaA, prismaB, prismaC, "fc_relay");
  try {
    const { coalitionId } = await formTriadCoalition(triad, "Relay Triad");

    // The hub-ness precondition, asserted: B and C know NOTHING of each other.
    assert.equal(await prismaB.federatedNode.count({ where: { domain: triad.c.domain } }), 0);
    assert.equal(await prismaC.federatedNode.count({ where: { domain: triad.b.domain } }), 0);

    // A person on B: presence on A (Pattern-1 prerequisite), then a routed
    // write into the coalition via its home.
    assert.equal(
      (await establishPresence(prismaB, { accountId: triad.b.stewardAccountId, peerDomain: triad.a.domain })).ok,
      true,
    );
    await triad.pump();
    const presenceB = await prismaB.federatedCoalitionPresence.findFirstOrThrow({
      where: { coalitionId, groupId: triad.b.groupId! },
    });
    const posted = await postFederatedCoalitionMessage(prismaB, {
      accountId: triad.b.stewardAccountId,
      presenceId: presenceB.id,
      body: "Greetings from node B's riverbank.",
    });
    assert.equal(posted.ok, true, `post failed: ${JSON.stringify(posted)}`);
    await triad.pump(); // leg 1: B → A (mediated, gated by the B↔A agreement)
    await triad.pump(); // leg 2: A → B, A → C (relay, gated per member agreement)

    // The home appended the message to the real coalition thread, authored by
    // B's shadow member.
    const homeMessage = await prismaA.discussionMessage.findFirstOrThrow({
      where: { thread: { spaceType: "coalition", spaceId: coalitionId } },
      include: { author: { select: { passwordHash: true, homeNode: { select: { domain: true } } } } },
    });
    assert.equal(homeMessage.body, "Greetings from node B's riverbank.");
    assert.equal(homeMessage.author.passwordHash, null);
    assert.equal(homeMessage.author.homeNode.domain, triad.b.domain);

    // THE PROOF: C holds the cached message, tagged with B's origin — and the
    // only possible path was via A, because C has never pinned B.
    const presenceC = await prismaC.federatedCoalitionPresence.findFirstOrThrow({
      where: { coalitionId, groupId: triad.c.groupId! },
    });
    const cachedOnC = await prismaC.federatedCoalitionMessage.findFirstOrThrow({
      where: { presenceId: presenceC.id },
    });
    assert.equal(cachedOnC.body, "Greetings from node B's riverbank.");
    assert.equal(cachedOnC.originDomain, triad.b.domain);

    // B receives the echo of its own member's message through the same relay.
    const cachedOnB = await prismaB.federatedCoalitionMessage.findFirstOrThrow({
      where: { presence: { coalitionId, groupId: triad.b.groupId! } },
    });
    assert.equal(cachedOnB.originDomain, triad.b.domain);
  } finally {
    await cleanupTriad("fc_relay");
  }
});
