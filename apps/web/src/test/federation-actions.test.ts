import "dotenv/config";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { mediateRemoteAction } from "../lib/federation-actions";
import { createFederationEnvelope } from "../lib/federation-envelope";
import { receiveFederationEnvelope } from "../lib/federation-inbox";
import { establishPresence } from "../lib/federation-presence";
import { generateEd25519KeyPairPem, nodeSigningProvider, signWithPrivateKeyPem } from "../lib/node-keys";
import { createPrismaClient } from "../lib/prisma";
import { hashSignedEventPayload } from "../lib/signed-events";
import { cleanupSide, createFederatedPair, ensureSecondDatabase, type FederatedPair } from "./federation-fixtures";

// Pattern-1 mediated actions: the F2 exit criterion. A person on node A acts
// on node B entirely via home-node mediation, and node B's ORDINARY local
// authorization decides — federation authenticates who acts, never what they
// may do.

let prismaA: PrismaClient;
let prismaB: PrismaClient;

before(async () => {
  const secondUrl = await ensureSecondDatabase();
  prismaA = createPrismaClient();
  prismaB = createPrismaClient(secondUrl);
});

after(async () => {
  await prismaA?.$disconnect();
  await prismaB?.$disconnect();
});

async function createGroupOnB(pair: FederatedPair, prefix: string, input: { open?: boolean; visibility?: "public" | "private" }) {
  return prismaB.group.create({
    data: {
      id: `${prefix}_target_${input.open === false ? "closed" : "open"}_${input.visibility ?? "public"}`,
      nodeId: pair.b.node.id,
      name: `${prefix} target ${input.open === false ? "closed" : "open"} ${input.visibility ?? "public"}`,
      membershipPolicy: input.open === false ? "petition" : "open",
      visibility: input.visibility ?? "public",
    },
  });
}

test("a mediated join lands through the remote node's ordinary authorization", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "act_happy", { activate: true });
  try {
    const group = await createGroupOnB(pair, "act_happy", { open: true });
    const established = await establishPresence(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
    });
    assert.equal(established.ok, true);
    await pair.pump();

    const mediated = await mediateRemoteAction(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
      actionType: "join_open_group",
      action: { groupId: group.id },
    });
    assert.equal(mediated.ok, true);
    await pair.pump();

    // The shadow account is the presence's member-shaped adapter: identity-
    // backed, homed truthfully on the peer's Node row, and credential-less.
    const shadow = await prismaB.account.findFirstOrThrow({
      where: { portableIdentity: { isNot: null }, homeNode: { domain: pair.a.domain } },
    });
    assert.equal(shadow.passwordHash, null);

    const membership = await prismaB.groupMembership.findUniqueOrThrow({
      where: { accountId_groupId: { accountId: shadow.id, groupId: group.id } },
    });
    assert.equal(membership.status, "active");
    // Zero local governance weight at F2 (D-5 in miniature, deliberate).
    assert.equal(membership.participationStatus, "dormant");

    // The home node keeps its identity-signed record of the act.
    const signedEvents = await prismaA.signedEvent.count({
      where: { eventType: "mediated_action_requested", actorAccountId: pair.a.stewardAccountId },
    });
    assert.equal(signedEvents, 1);
  } finally {
    await cleanupSide(prismaA, "act_happy");
    await cleanupSide(prismaB, "act_happy");
  }
});

test("local {ok:false} authorization propagates: closed groups refuse, private groups read as not found", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "act_refuse", { activate: true });
  try {
    const closedGroup = await createGroupOnB(pair, "act_refuse", { open: false });
    const privateGroup = await createGroupOnB(pair, "act_refuse", { visibility: "private" });
    const established = await establishPresence(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
    });
    assert.equal(established.ok, true);
    await pair.pump();

    for (const [groupId, expected] of [
      [closedGroup.id, "This group is not open to join."],
      [privateGroup.id, "not_found"],
    ] as const) {
      const mediated = await mediateRemoteAction(prismaA, {
        accountId: pair.a.stewardAccountId,
        peerDomain: pair.b.domain,
        actionType: "join_open_group",
        action: { groupId },
      });
      assert.equal(mediated.ok, true); // enqueue succeeds; the REMOTE decision is what refuses
      await pair.pump();

      const inbound = await prismaB.federationInboundEvent.findFirst({
        where: { eventType: "mediated_action", error: expected },
      });
      assert.ok(inbound, `expected recorded refusal: ${expected}`);
      assert.equal(inbound!.outcome, "rejected");
    }
    assert.equal(await prismaB.groupMembership.count({ where: { groupId: closedGroup.id } }), 0);
    assert.equal(await prismaB.groupMembership.count({ where: { groupId: privateGroup.id } }), 0);
  } finally {
    await cleanupSide(prismaA, "act_refuse");
    await cleanupSide(prismaB, "act_refuse");
  }
});

test("no presence, revoked presence, and unregistered action types are refused", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "act_gates", { activate: true });
  try {
    const group = await createGroupOnB(pair, "act_gates", { open: true });

    // Unregistered action type is refused at the HOME side already.
    const unknown = await mediateRemoteAction(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
      actionType: "delete_everything",
      action: {},
    });
    assert.deepEqual(unknown, { ok: false, reason: "unknown_action_type" });

    // Acting without an established presence: refused remotely.
    const mediated = await mediateRemoteAction(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
      actionType: "join_open_group",
      action: { groupId: group.id },
    });
    assert.equal(mediated.ok, true);
    await pair.pump();
    const noPresence = await prismaB.federationInboundEvent.findFirst({
      where: { eventType: "mediated_action", error: "unknown_identity" },
    });
    assert.ok(noPresence, "an identity with no presence must be refused");

    // Establish, revoke, then act: the revoked presence blocks the action.
    assert.equal(
      (await establishPresence(prismaA, { accountId: pair.a.stewardAccountId, peerDomain: pair.b.domain })).ok,
      true,
    );
    await pair.pump();
    const identityOnB = await prismaB.portableIdentity.findFirstOrThrow({
      where: { linkedNodePresences: { some: { nodeId: pair.b.node.id } } },
    });
    await prismaB.linkedNodePresence.updateMany({
      where: { portableIdentityId: identityOnB.id, nodeId: pair.b.node.id },
      data: { status: "revoked" },
    });
    const afterRevoke = await mediateRemoteAction(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
      actionType: "join_open_group",
      action: { groupId: group.id },
    });
    assert.equal(afterRevoke.ok, true);
    await pair.pump();
    const revokedRefusal = await prismaB.federationInboundEvent.findFirst({
      where: { eventType: "mediated_action", error: "presence_revoked" },
    });
    assert.ok(revokedRefusal, "a revoked presence must not act");
    assert.equal(await prismaB.groupMembership.count({ where: { groupId: group.id } }), 0);
  } finally {
    await cleanupSide(prismaA, "act_gates");
    await cleanupSide(prismaB, "act_gates");
  }
});

test("a tampered action fails the actor signature; a replayed action applies once", async () => {
  const pair = await createFederatedPair(prismaA, prismaB, "act_sig", { activate: true });
  try {
    const group = await createGroupOnB(pair, "act_sig", { open: true });
    assert.equal(
      (await establishPresence(prismaA, { accountId: pair.a.stewardAccountId, peerDomain: pair.b.domain })).ok,
      true,
    );
    await pair.pump();
    const identityOnB = await prismaB.portableIdentity.findFirstOrThrow({
      where: { linkedNodePresences: { some: { nodeId: pair.b.node.id } } },
    });

    // Tampered: the actor signature covers a DIFFERENT action than delivered.
    // Signed by a fresh key to model an attacker without the member's key —
    // the home node's envelope signature alone must not authorize the act.
    const attackerKeys = generateEd25519KeyPairPem();
    const claim = {
      purpose: "mediated_action",
      did: identityOnB.did,
      actionType: "join_open_group",
      action: { groupId: group.id },
      nonce: "tampered-nonce",
    };
    const signerA = await nodeSigningProvider(prismaA, pair.a.node.id);
    const tampered = createFederationEnvelope({
      eventType: "mediated_action",
      payload: {
        did: identityOnB.did,
        actionType: "join_open_group",
        action: { groupId: group.id },
        nonce: "tampered-nonce",
        actorSignature: signWithPrivateKeyPem(attackerKeys.privateKeyPem, hashSignedEventPayload(claim)),
      },
      originDomain: pair.a.domain,
      keyId: signerA.keyId,
      signer: signerA.provider,
      publicKey: signerA.publicKey,
    });
    const outcome = await receiveFederationEnvelope(prismaB, JSON.parse(JSON.stringify(tampered)), {
      localNode: pair.b.node,
    });
    assert.deepEqual(outcome, { outcome: "rejected", reason: "bad_actor_signature" });

    // Replay: one legitimate mediated action delivered twice applies once.
    const mediated = await mediateRemoteAction(prismaA, {
      accountId: pair.a.stewardAccountId,
      peerDomain: pair.b.domain,
      actionType: "join_open_group",
      action: { groupId: group.id },
    });
    assert.equal(mediated.ok, true);
    const outboxItem = await prismaA.federationOutboxItem.findFirstOrThrow({
      where: { eventType: "mediated_action", status: "pending" },
    });
    await pair.pump();
    const replay = await receiveFederationEnvelope(
      prismaB,
      JSON.parse(JSON.stringify(outboxItem.envelope)),
      { localNode: pair.b.node },
    );
    assert.equal(replay.outcome, "duplicate");
    assert.equal(await prismaB.groupMembership.count({ where: { groupId: group.id } }), 1);
  } finally {
    await cleanupSide(prismaA, "act_sig");
    await cleanupSide(prismaB, "act_sig");
  }
});
