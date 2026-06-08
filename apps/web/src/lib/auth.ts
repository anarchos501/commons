import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import type { SessionData } from "./session";

// First-run bootstrap: when nobody has registered yet, the very first
// registrant founds the node simply by arriving — its domain is taken
// solely from the normalized request Host the caller resolved (never
// client form input), and the name defaults to that domain since there is
// no UI yet to rename it. This intentionally creates only the Node:
// NodeHost status stays earned exclusively by creating the first group
// (see createGroup in group-settings.ts) — registering must never imply
// host authority.
async function ensureFirstNode(prisma: PrismaClient, requestHost: string) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('commons:first-node-bootstrap'))`;
      const existing = await tx.node.findFirst({ orderBy: { createdAt: "asc" } });
      if (existing) return existing;

      const domain = requestHost || "localhost";
      try {
        return await tx.node.create({ data: { name: domain, domain } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return tx.node.findUniqueOrThrow({ where: { domain } });
        }
        throw error;
      }
    },
  );
}

async function createAccountForRegistration(
  prisma: PrismaClient,
  input: { email: string; displayName: string; password: string; requestHost: string },
): Promise<SessionData> {
  const node = await ensureFirstNode(prisma, input.requestHost);
  const passwordHash = await bcrypt.hash(input.password, 12);

  try {
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("An account with that email already exists.");
    }
    throw error;
  }
}

export async function registerAccount(
  prisma: PrismaClient,
  input: { email: string; displayName: string; password: string; requestHost: string },
): Promise<SessionData> {
  const existing = await prisma.account.findUnique({ where: { email: input.email } });

  if (existing) {
    throw new Error("An account with that email already exists.");
  }

  return createAccountForRegistration(prisma, input);
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
