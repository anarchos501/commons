import { LogOut, Menu } from "lucide-react";
import type { SidebarData } from "../../lib/sidebar-data";
import { SidebarShell } from "./SidebarShell";
import { ThemeToggle } from "../theme/ThemeToggle";
import { SidebarNavClient } from "./SidebarNavClient";

interface Props {
  data: SidebarData;
}

export function Sidebar({ data }: Props) {
  const trigger = (
    <button aria-label="Open navigation" className="btn-icon p-2 hover:bg-[var(--hover)]">
      <Menu className="h-5 w-5 text-[var(--text)]" />
    </button>
  );

  return (
    <SidebarShell trigger={trigger}>
      <SidebarNavClient data={data} />

      {/* Footer: theme + logout */}
      <div className="border-t border-[var(--border)] px-3 py-3 flex items-center justify-between">
        <span className="text-xs text-[var(--muted)] truncate">{data.displayName}</span>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Log out"
              className="btn-icon p-1.5 hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--text)]"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      </div>
    </SidebarShell>
  );
}

async function logoutAction() {
  "use server";
  const { getSession } = await import("../../lib/session");
  const session = await getSession();
  await session.destroy();
  const { redirect } = await import("next/navigation");
  redirect("/login");
}
