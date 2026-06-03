import { redirect } from "next/navigation";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";

type PageProps = { params: Promise<{ projectId: string }> };

export default async function ProjectSpacePage({ params }: PageProps) {
  const { projectId } = await params;
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const prisma = createPrismaClient();
  let groupId: string | null = null;
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { groupId: true },
    });
    if (!project) {
      groupId = null;
    } else {
      const membership = await prisma.groupMembership.findUnique({
        where: { accountId_groupId: { accountId: session.accountId, groupId: project.groupId } },
        select: { status: true },
      });
      groupId = membership?.status === "active" ? project.groupId : null;
    }
  } finally {
    await prisma.$disconnect();
  }

  if (!groupId) redirect("/dashboard");
  redirect(`/groups/${groupId}#projects`);
}
