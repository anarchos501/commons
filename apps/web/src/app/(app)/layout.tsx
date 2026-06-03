import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { getSidebarData } from "../../lib/sidebar-data";
import { createPrismaClient } from "../../lib/prisma";
import { Sidebar } from "../../components/sidebar/Sidebar";

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

  return (
    <div className="flex min-h-full">
      <Sidebar data={sidebar} />
      <div className="flex flex-1 flex-col min-w-0">
        {children}
      </div>
    </div>
  );
}
