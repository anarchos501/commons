import { serveContinuityStatus } from "../../../../lib/continuity-status";
import { resolveCurrentNode } from "../../../../lib/node-context";
import { createPrismaClient } from "../../../../lib/prisma";

// F3.5 quiet-boot status pull — Commons' FIRST pull endpoint (register F-4,
// amended). Server-to-server only; the request is node-signed (verified
// against the requester's PINNED key) and the response is node-signed (the
// caller verifies against OUR pinned key). The signed request is itself
// proof of life: receiving it closes any open challenge for that origin.
// Core logic lives in lib/continuity-status.ts.

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = {
    origin: url.searchParams.get("origin") ?? "",
    entityType: url.searchParams.get("entityType") ?? "",
    entityId: url.searchParams.get("entityId") ?? "",
    includeLog: url.searchParams.get("includeLog") ?? "0",
    afterSeq: url.searchParams.get("afterSeq") ?? "0",
    ts: url.searchParams.get("ts") ?? "",
    sig: url.searchParams.get("sig") ?? "",
  };
  const prisma = createPrismaClient();
  try {
    const localNode = await resolveCurrentNode(prisma);
    const result = await serveContinuityStatus(prisma, query, localNode);
    return Response.json(result.body, { status: result.status });
  } catch {
    return Response.json({ error: "transient" }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
