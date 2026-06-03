import Link from "next/link";
import { Bell, HelpCircle, LogOut, Menu, Users } from "lucide-react";
import type { SidebarData } from "../../lib/sidebar-data";
import { SidebarShell } from "./SidebarShell";
import { ThemeToggle } from "../theme/ThemeToggle";

interface Props {
  data: SidebarData;
}

export function Sidebar({ data }: Props) {
  const { groupMemberships, projectMemberships, responsibilityAssignments, unreadRouteCount } = data;

  const trigger = (
    <button aria-label="Open navigation" className="p-2 rounded hover:bg-[var(--hover)]">
      <Menu className="h-5 w-5 text-[var(--text)]" />
    </button>
  );

  return (
    <SidebarShell trigger={trigger}>
      <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4 gap-1">
        {/* Wordmark */}
        <Link href="/dashboard" className="mb-4 px-2 text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] hidden lg:block">
          Commons
        </Link>

        {/* Primary actions */}
        <NavLink href="/request" icon={<HelpCircle className="h-4 w-4" />}>
          Request Help
        </NavLink>
        <NavLink href="/dashboard#routes" icon={<Bell className="h-4 w-4" />} badge={unreadRouteCount}>
          Notifications
        </NavLink>
        <NavLink href="/dashboard#my-requests" icon={null}>
          My Requests
        </NavLink>

        {/* My Groups */}
        {groupMemberships.length > 0 && (
          <NavSection label="My Groups">
            {groupMemberships.map((m) => (
              <NavLink key={m.groupId} href={`/groups/${m.groupId}`} icon={<Users className="h-3.5 w-3.5" />} indent>
                {m.groupName}
              </NavLink>
            ))}
          </NavSection>
        )}

        {/* My Projects — only if user has project memberships */}
        {projectMemberships.length > 0 && (
          <NavSection label="My Projects">
            {projectMemberships.map((m) => (
              <NavLink key={m.projectId} href={`/projects/${m.projectId}`} icon={null} indent>
                {m.projectName}
              </NavLink>
            ))}
          </NavSection>
        )}

        {/* My Responsibilities — only if user holds any */}
        {responsibilityAssignments.length > 0 && (
          <NavSection label="My Responsibilities">
            {responsibilityAssignments.map((a, i) => (
              <NavLink key={i} href={`/groups/${a.groupId}#responsibilities`} icon={null} indent>
                {a.type.charAt(0).toUpperCase() + a.type.slice(1)}
              </NavLink>
            ))}
          </NavSection>
        )}

        {/* Discovery */}
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <NavLink href="/request" icon={null}>
            Find Groups
          </NavLink>
          <NavLink href="/" icon={null}>
            About Commons
          </NavLink>
        </div>
      </nav>

      {/* Footer: theme + logout */}
      <div className="border-t border-[var(--border)] px-3 py-3 flex items-center justify-between">
        <span className="text-xs text-[var(--muted)] truncate">{data.displayName}</span>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action={logoutAction}>
            <button type="submit" aria-label="Log out" className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--text)]">
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

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <p className="mb-1 px-2 text-xs font-medium text-[var(--muted)]">{label}</p>
      {children}
    </div>
  );
}

function NavLink({
  href,
  icon,
  badge,
  indent = false,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  badge?: number;
  indent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm text-[var(--soft-text)] hover:bg-[var(--hover)] hover:text-[var(--text)] transition ${indent ? "pl-5" : ""}`}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-xs font-medium text-[var(--accent-text)]">
          {badge}
        </span>
      )}
    </Link>
  );
}
