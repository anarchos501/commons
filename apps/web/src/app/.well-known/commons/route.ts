import { ensureNodeKeyPair } from "../../../lib/node-keys";
import { absoluteUrl, resolveCurrentNode } from "../../../lib/node-context";
import { createPrismaClient } from "../../../lib/prisma";

// Node identity + key + policy discovery (register F-4: the discovery half of
// Commons' first API). Server-to-server consumers pin the key they see here.
export async function GET(request: Request): Promise<Response> {
  const prisma = createPrismaClient();
  try {
    const node = await resolveCurrentNode(prisma);
    if (!node) {
      return Response.json({ commons: true, error: "node_not_initialized" }, { status: 503 });
    }

    const key = await ensureNodeKeyPair(prisma, node.id);
    // Raw Host header, not the normalized host: absoluteUrl needs the dev
    // :port the normalizer strips (the two-node harness distinguishes
    // instances by port).
    const requestHost = request.headers.get("host");

    return Response.json({
      commons: true,
      version: 1,
      node: { name: node.name, domain: node.domain },
      publicKey: key.publicKey,
      keyId: key.id,
      // Fail-closed legibility: without a steward collective there is no
      // entity to receive or propose agreements, so a remote requester sees
      // an honest refusal instead of a silent timeout (register F-5).
      federation: node.stewardGroupId === null ? "unavailable" : node.federationPolicy,
      endpoints: {
        inbox: absoluteUrl(node.domain, requestHost, "/api/federation/inbox"),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}
