import Link from "next/link";
import { HelpCircle } from "lucide-react";
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
    <div className="flex flex-col min-h-full">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center">
          <div className="flex-1" />
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] transition-colors"
          >
            Commons
          </Link>
          <div className="flex flex-1 justify-end">
            <nav className="flex items-center gap-2">
              <Link
                href="/request"
                className="btn-primary flex items-center gap-1.5 bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--surface)]"
              >
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Request Help
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <Sidebar data={sidebar} />
        <div className="flex flex-1 flex-col min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
