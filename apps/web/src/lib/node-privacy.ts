import type { PrismaClient } from "../generated/prisma/client";

export type NodeGroupLabel = {
  id: string;
  label: string;
  isPrivate: boolean;
};

export async function labelNodeGroupForAccount(
  prisma: PrismaClient,
  groupId: string | null,
  accountId: string,
): Promise<NodeGroupLabel | null> {
  if (!groupId) return null;
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      visibility: true,
      memberships: {
        where: { accountId, status: "active" },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!group) return null;
  const canSee = group.visibility === "public" || group.memberships.length > 0;
  return { id: group.id, label: canSee ? group.name : "Private group", isPrivate: !canSee };
}

export async function listNodeGroupLabelsForAccount(
  prisma: PrismaClient,
  nodeId: string,
  accountId: string,
): Promise<NodeGroupLabel[]> {
  const groups = await prisma.group.findMany({
    where: { nodeId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      visibility: true,
      memberships: {
        where: { accountId, status: "active" },
        select: { id: true },
        take: 1,
      },
    },
  });
  return groups.map((group) => {
    const canSee = group.visibility === "public" || group.memberships.length > 0;
    // Unseen private groups are labeled uniformly — never numbered. A per-group index would leak
    // the count and relative position of private groups the viewer can't otherwise see.
    return {
      id: group.id,
      label: canSee ? group.name : "Private group",
      isPrivate: !canSee,
    };
  });
}
