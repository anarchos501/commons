import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ensureEscrowWrap, unwrapEscrowedIdentityKey, wrapIdentityKeyForEscrow, buildEscrowEntries } from "../lib/identity-escrow";
import { registerAccount } from "../lib/auth";
import { createPrismaClient } from "../lib/prisma";

const prisma = createPrismaClient();
const prefix = `escrow_${randomUUID().slice(0, 6)}`;

test.after(async () => {
  await prisma.groupMembership.deleteMany({ where: { group: { nodeId: { startsWith: prefix } } } });
  await prisma.group.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.identityKeyCustody.deleteMany({
    where: { portableIdentity: { accounts: { some: { homeNode: { id: { startsWith: prefix } } } } } },
  });
  await prisma.account.deleteMany({ where: { homeNode: { id: { startsWith: prefix } } } });
  await prisma.portableIdentity.deleteMany({ where: { accounts: { none: {} }, linkedNodePresences: { none: {} } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.$disconnect();
});

test("wrap/unwrap roundtrips with the right password and fails closed with the wrong one", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nfake-key-material\n-----END PRIVATE KEY-----";
  const blob = wrapIdentityKeyForEscrow("correct horse battery", pem);
  assert.equal(unwrapEscrowedIdentityKey("correct horse battery", blob), pem);
  assert.throws(() => unwrapEscrowedIdentityKey("wrong password", blob));
  // Two wraps of the same key are distinct blobs (fresh salt + IV).
  const again = wrapIdentityKeyForEscrow("correct horse battery", pem);
  assert.notEqual(again.wrapped, blob.wrapped);
});

test("registration wraps at creation; password change rewraps; replicas can carry entries", async () => {
  const node = await prisma.node.create({ data: { id: `${prefix}_node`, name: prefix, domain: `${prefix}.example` } });
  // ensureFirstNode would race the fixture node; register against the node's domain host.
  const session = await registerAccount(prisma, {
    email: `${prefix}@example.org`,
    displayName: "Escrowed Member",
    password: "first-password-123",
    requestHost: `${prefix}.example`,
  });

  const account = await prisma.account.findUniqueOrThrow({
    where: { id: session.accountId },
    include: { portableIdentity: { include: { keyCustody: true } } },
  });
  assert.ok(account.portableIdentity, "registration creates the identity eagerly");
  const custody = account.portableIdentity!.keyCustody!;
  assert.ok(custody.escrowWrappedKey && custody.escrowSalt, "registration wraps under the password");
  // The wrap opens with the password and contains the REAL signing key.
  const pem = unwrapEscrowedIdentityKey("first-password-123", {
    salt: custody.escrowSalt!,
    wrapped: custody.escrowWrappedKey!,
  });
  assert.equal(pem, custody.signingPrivateKeyPem);

  // Password change → rewrap (C1's reset must do exactly this; enforced-test
  // coupling noted in the plan).
  await ensureEscrowWrap(prisma, { accountId: account.id, password: "second-password-456", force: true });
  const after = await prisma.identityKeyCustody.findUniqueOrThrow({ where: { id: custody.id } });
  assert.notEqual(after.escrowWrappedKey, custody.escrowWrappedKey);
  assert.throws(() =>
    unwrapEscrowedIdentityKey("first-password-123", { salt: after.escrowSalt!, wrapped: after.escrowWrappedKey! }),
  );
  assert.equal(
    unwrapEscrowedIdentityKey("second-password-456", { salt: after.escrowSalt!, wrapped: after.escrowWrappedKey! }),
    custody.signingPrivateKeyPem,
  );

  // Replica-bound entries carry the CURRENT blob.
  const group = await prisma.group.create({
    data: { id: `${prefix}_grp`, nodeId: node.id, name: `${prefix} grp`, membershipPolicy: "open", visibility: "public" },
  });
  await prisma.groupMembership.create({
    data: { id: `${prefix}_mem`, accountId: account.id, groupId: group.id, status: "active", participationStatus: "active" },
  });
  const entries = await buildEscrowEntries(prisma, group.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].wrapped, after.escrowWrappedKey);
  assert.equal(entries[0].did, account.portableIdentity!.did);
});

// SERVER DISCIPLINE (register D-8/D-10): the unwrap primitive must never be
// invoked with server-held material — production server code never calls it.
// Same architectural-scan move as the outbox transport-privacy test.
test("unwrapEscrowedIdentityKey is never called from production server code", () => {
  const srcRoot = join(__dirname, "..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "test" || entry.name === "generated" || entry.name === "node_modules") continue;
        walk(path);
      } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
        const relative = path.slice(srcRoot.length + 1);
        if (relative === "lib/identity-escrow.ts") continue; // the definition
        const content = readFileSync(path, "utf8");
        if (content.includes("unwrapEscrowedIdentityKey(")) offenders.push(relative);
      }
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, [], `server code must never unwrap escrow: ${offenders.join(", ")}`);
});
