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

  const node = await prisma.node.findFirst({ orderBy: { createdAt: "asc" } });
  if (!node) {
    throw new Error(
      "Commons is not initialized. Run `pnpm db:seed` for local development, then try again.",
    );
  }
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
    activeGroupId: null,
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

  // Temporary default:
  // choose earliest active membership as the initial active context.
  //
  // Future:
  // Account.lastActiveGroupId should become the preferred source.
  // This is only a fallback until active context persistence exists.
  const membership = await prisma.groupMembership.findFirst({
    where: { accountId: account.id, status: "active" },
    orderBy: { joinedAt: "asc" },
    select: { groupId: true },
  });
  const activeGroupId = membership?.groupId ?? null;

  return {
    accountId: account.id,
    displayName: account.displayName,
    nodeId: account.homeNodeId,
    activeGroupId,
  };
}
