import { getSession } from "../../lib/session";
import { getSidebarData } from "../../lib/sidebar-data";
import { createPrismaClient } from "../../lib/prisma";
import { PublicShell } from "../../components/PublicShell";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const isAuthenticated = !!session.accountId;

  let sidebar = null;
  if (isAuthenticated && session.accountId) {
    const prisma = createPrismaClient();
    try {
      sidebar = await getSidebarData(prisma, session.accountId);
    } finally {
      await prisma.$disconnect();
    }
  }

  return (
    <PublicShell sidebarData={sidebar} isAuthenticated={isAuthenticated}>
      {children}
    </PublicShell>
  );
}
