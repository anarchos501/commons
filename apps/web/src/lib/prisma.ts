import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../generated/prisma/client";

export function createPrismaClient(connectionString = process.env.DATABASE_URL ?? readDatabaseUrlFromEnvFile()): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create a Prisma client.");
  }

  return new PrismaClient({ adapter: new PrismaPg(connectionString) });
}

/**
 * Guards a function whose `pg_advisory_xact_lock` is only meaningful inside an
 * active Postgres transaction: called outside one, the lock is acquired and
 * immediately released, silently providing no serialization.
 *
 * Runtime discriminator: the interactive-transaction client omits the
 * connection-lifecycle methods (`$connect`/`$disconnect`/`$on`/`$extends`),
 * whereas a bare `PrismaClient` exposes them. (Note: `$transaction` itself is
 * NOT a reliable discriminator on Prisma 7.8 — it is present as a function on
 * both — so we probe `$connect` instead.)
 */
export function assertWithinTransaction(client: Prisma.TransactionClient, fnName: string): void {
  if (typeof (client as { $connect?: unknown }).$connect === "function") {
    throw new Error(`${fnName} must be called within a prisma.$transaction(...) — its advisory lock is inert otherwise`);
  }
}

function readDatabaseUrlFromEnvFile(): string | undefined {
  const envPath = join(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return undefined;
  }

  const match = readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.*)$/m);
  return match?.[1]?.trim().replace(/^"|"$/g, "");
}