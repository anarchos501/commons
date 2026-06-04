import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { getSidebarData } from "../../lib/sidebar-data";
import { createPrismaClient } from "../../lib/prisma";
import { AppShell } from "../../components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const prisma = createPrismaClient();
  let sidebar;
  try {
    sidebar = await getSidebarData(prisma, session.accountId);
  } finally {
    await prisma.$disconnect();
  }

  return <AppShell sidebarData={sidebar}>{children}</AppShell>;
}
