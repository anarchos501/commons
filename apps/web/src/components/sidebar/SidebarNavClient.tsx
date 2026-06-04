"use client";

import Link from "next/link";
import { Bell, HelpCircle, LayoutDashboard, UserRound, Users } from "lucide-react";
import type { SidebarData } from "../../lib/sidebar-data";

interface Props {
  data: SidebarData;
}

export function SidebarNavClient({ data }: Props) {
  return <GlobalSidebarNav data={data} />;
}

function GlobalSidebarNav({ data }: { data: SidebarData }) {
  const { groupMemberships, unreadRouteCount } = data;

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4 gap-1">
      <Link
        href="/dashboard"
        className="mb-4 px-2 text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] hidden lg:block"
      >
        Commons
      </Link>

      <NavLink href="/dashboard#request" icon={<HelpCircle className="h-4 w-4" />}>
        Request Support
      </NavLink>
      <NavLink href="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />}>
        Dashboard
      </NavLink>

      {groupMemberships.length > 0 && (
        <>
          <p className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-[var(--soft-text)]">
            <Users className="h-3.5 w-3.5" />
            My Groups
          </p>
          {groupMemberships.map((m) => (
            <NavLink key={m.groupId} href={`/groups/${m.groupId}`} icon={null} indent>
              {m.groupName}
            </NavLink>
          ))}
        </>
      )}

      <div className="border-t border-[var(--border)] mt-1 pt-1">
        <NavLink href="/groups" icon={<UserRound className="h-4 w-4" />}>Find Groups</NavLink>
        <NavLink href="/dashboard#routes" icon={<Bell className="h-4 w-4" />} badge={unreadRouteCount}>
          Notifications
        </NavLink>
      </div>
    </nav>
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
      className={`nav-link flex items-center gap-2 px-2 py-1.5 text-sm text-[var(--soft-text)] hover:text-[var(--text)] ${indent ? "pl-4" : ""}`}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {badge != null && badge > 0 && (
        <span className="bg-[var(--accent)] px-1.5 py-0.5 text-xs font-medium text-[var(--accent-text)]">
          {badge}
        </span>
      )}
    </Link>
  );
}
