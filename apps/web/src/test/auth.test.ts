import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { registerAccount } from "../lib/auth";
import { normalizeRequestHost } from "../lib/node-context";
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
      requestHost: `${prefix}-arrival.localhost`,
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

test("registerAccount founds the first Node from the request host when none exists yet, without granting NodeHost", async () => {
  const createdNodes: Array<{ name: string; domain: string }> = [];
  let nodeHostTouched = false;
  const founderHost = "founders-commons.example";

  const fakePrisma = {
    account: {
      findUnique: async () => null,
      create: async ({ data }: { data: { homeNodeId: string; displayName: string; email: string } }) => ({
        id: "acct_founding",
        homeNodeId: data.homeNodeId,
        displayName: data.displayName,
        email: data.email,
      }),
    },
    node: {
      findFirst: async () => null,
      create: async ({ data }: { data: { name: string; domain: string } }) => {
        createdNodes.push({ name: data.name, domain: data.domain });
        return { id: "node_founding", name: data.name, domain: data.domain, createdAt: new Date() };
      },
    },
    $transaction: async (callback: (tx: PrismaClient) => unknown) =>
      callback({
        node: {
          findFirst: async () => null,
          create: async ({ data }: { data: { name: string; domain: string } }) => {
            createdNodes.push({ name: data.name, domain: data.domain });
            return { id: "node_founding", name: data.name, domain: data.domain, createdAt: new Date() };
          },
        },
        $executeRaw: async () => 0,
      } as unknown as PrismaClient),
    nodeHost: {
      create: async () => {
        nodeHostTouched = true;
        throw new Error("registerAccount must never create a NodeHost — that is earned by founding the first group.");
      },
      count: async () => {
        nodeHostTouched = true;
        return 0;
      },
    },
  } as unknown as PrismaClient;

  const session = await registerAccount(fakePrisma, {
    email: "founder@test.local",
    displayName: "Founding member",
    password: "testpass123",
    requestHost: founderHost,
  });

  assert.deepEqual(createdNodes, [{ name: founderHost, domain: founderHost }]);
  assert.equal(session.nodeId, "node_founding");
  assert.equal(session.activeGroupId, null);
  assert.equal(nodeHostTouched, false);
});

test("normalizeRequestHost strips ports and handles local IPv6 hosts", () => {
  assert.equal(normalizeRequestHost("Example.COM:3000"), "example.com");
  assert.equal(normalizeRequestHost("[::1]:3000"), "::1");
  assert.equal(normalizeRequestHost("  localhost  "), "localhost");
  assert.equal(normalizeRequestHost("bad host/name:3000"), "");
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
