import type { PrismaClient } from "../generated/prisma/client";

type LogActionInput = {
  actorAccountId?: string | null;
  groupId?: string | null;
  projectId?: string | null;
  targetType: string;
  targetId: string;
  action: string;
  metadata?: Record<string, unknown>;
};

/**
 * Best-effort audit logging.
 * Failures are reported in development but do not block user workflows.
 */
export async function logAction(prisma: PrismaClient, input: LogActionInput): Promise<void> {
  try {
    await prisma.actionLog.create({
      data: {
        actorAccountId: input.actorAccountId ?? null,
        groupId: input.groupId ?? null,
        projectId: input.projectId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[action-log] Failed to write action log entry:", error);
    }
  }
}
