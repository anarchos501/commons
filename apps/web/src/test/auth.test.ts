import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { registerAccount } from "../lib/auth";
import { createPrismaClient } from "../lib/prisma";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("registerAccount creates an account on the earliest configured node", async () => {
  const prefix = "auth_register";
  await cleanup(prefix);
  try {
    const earlierNode = await prisma.node.create({
      data: {
        id: `${prefix}_node_earlier`,
        name: "Earlier node",
        domain: `${prefix}-earlier.localhost`,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await prisma.node.create({
      data: {
        id: `${prefix}_node_later`,
        name: "Later node",
        domain: `${prefix}-later.localhost`,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    const session = await registerAccount(prisma, {
      email: `${prefix}@test.local`,
      displayName: "New member",
      password: "testpass123",
    });

    assert.equal(session.nodeId, earlierNode.id);
    assert.equal(session.activeGroupId, null);
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: `${prefix}@test.local` },
    });
    assert.equal(account.homeNodeId, earlierNode.id);
    assert.notEqual(account.passwordHash, "testpass123");
    assert.equal(await prisma.nodeHost.count({ where: { accountId: account.id } }), 0);
  } finally {
    await cleanup(prefix);
  }
});

test("registerAccount reports a clear initialization error when no node exists", async () => {
  const fakePrisma = {
    account: {
      findUnique: async () => null,
    },
    node: {
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;

  await assert.rejects(
    () =>
      registerAccount(fakePrisma, {
        email: "new@test.local",
        displayName: "New member",
        password: "testpass123",
      }),
    /Commons is not initialized.*pnpm db:seed/,
  );
});

async function cleanup(prefix: string) {
  await prisma.account.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { email: { startsWith: prefix } },
      ],
    },
  });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
