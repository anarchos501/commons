import { LogOut } from "lucide-react";
import type { SidebarData } from "../../lib/sidebar-data";
import { SidebarShell } from "./SidebarShell";
import { ThemeToggle } from "../theme/ThemeToggle";
import { SidebarNavClient } from "./SidebarNavClient";
import { logoutAction } from "../../lib/logout-action";

interface Props {
  data: SidebarData;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ data, open, onClose }: Props) {
  return (
    <SidebarShell open={open} onClose={onClose}>
      <SidebarNavClient data={data} />

      {/* Footer: theme + logout */}
      <div className="border-t border-[var(--border)] px-3 py-3 flex items-center justify-between">
        <span className="text-xs text-[var(--muted)] truncate">{data.displayName}</span>
        <div className="flex items-center gap-1 shrink-0">
          <ThemeToggle />
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </button>
          </form>
        </div>
      </div>
    </SidebarShell>
  );
}
