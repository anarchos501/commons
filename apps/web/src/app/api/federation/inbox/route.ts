import { receiveFederationEnvelope } from "../../../../lib/federation-inbox";
import { createPrismaClient } from "../../../../lib/prisma";

// Server-to-server delivery endpoint — browsers never call this (register F-4).
// Duplicate is reported as 200 so the sender's outbox stops retrying.
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return Response.json({ outcome: "rejected", reason: "unreadable_body" }, { status: 400 });
  }
  if (text.length > MAX_BODY_BYTES) {
    return Response.json({ outcome: "rejected", reason: "body_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ outcome: "rejected", reason: "malformed" }, { status: 400 });
  }

  const prisma = createPrismaClient();
  try {
    const result = await receiveFederationEnvelope(prisma, body);
    if (result.outcome === "rejected") {
      const status =
        result.reason === "unknown_origin" || result.reason === "bad_signature" ? 401 : 400;
      return Response.json(result, { status });
    }
    return Response.json(result, { status: 200 });
  } catch {
    // Transient failure: the handler transaction rolled back; the sender
    // retries with backoff.
    return Response.json({ outcome: "error", reason: "transient" }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
