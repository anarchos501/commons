import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

export function createPrismaClient(connectionString = process.env.DATABASE_URL ?? readDatabaseUrlFromEnvFile()): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create a Prisma client.");
  }

  return new PrismaClient({ adapter: new PrismaPg(connectionString) });
}

function readDatabaseUrlFromEnvFile(): string | undefined {
  const envPath = join(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return undefined;
  }

  const match = readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.*)$/m);
  return match?.[1]?.trim().replace(/^"|"$/g, "");
}