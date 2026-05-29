import bcrypt from "bcryptjs";
import type { PrismaClient } from "../generated/prisma/client";
import type { SessionData } from "./session";

export async function registerAccount(
  prisma: PrismaClient,
  input: { email: string; displayName: string; password: string },
): Promise<SessionData> {
  const existing = await prisma.account.findUnique({ where: { email: input.email } });

  if (existing) {
    throw new Error("An account with that email already exists.");
  }

  const node = await prisma.node.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const passwordHash = await bcrypt.hash(input.password, 12);

  const account = await prisma.account.create({
    data: {
      homeNodeId: node.id,
      displayName: input.displayName,
      email: input.email,
      passwordHash,
      accountType: "participant",
      profileVisibility: "private",
    },
  });

  return {
    accountId: account.id,
    displayName: account.displayName,
    nodeId: node.id,
    groupId: null,
  };
}

export async function loginAccount(
  prisma: PrismaClient,
  input: { email: string; password: string },
): Promise<SessionData> {
  const account = await prisma.account.findUnique({ where: { email: input.email } });

  if (!account || !account.passwordHash) {
    throw new Error("Invalid email or password.");
  }

  const valid = await bcrypt.compare(input.password, account.passwordHash);

  if (!valid) {
    throw new Error("Invalid email or password.");
  }

  // Interim proxy until GroupMembership (Slice 2): members get their node's first group,
  // participants get null. GroupMembership query replaces this in Slice 2.
  const groupId =
    account.accountType === "member"
      ? (await prisma.group.findFirst({ where: { nodeId: account.homeNodeId }, orderBy: { createdAt: "asc" } }))?.id ?? null
      : null;

  return {
    accountId: account.id,
    displayName: account.displayName,
    nodeId: account.homeNodeId,
    groupId,
  };
}
