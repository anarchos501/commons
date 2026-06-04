"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Bell, HelpCircle, LayoutDashboard, UserRound, Users } from "lucide-react";
import type { SidebarData } from "../../lib/sidebar-data";

interface Props {
  data: SidebarData;
}

const GROUP_ROUTE = /^\/groups\/([^/]+)/;

export function SidebarNavClient({ data }: Props) {
  const pathname = usePathname();
  const groupMatch = GROUP_ROUTE.exec(pathname);
  const activeGroupId = groupMatch?.[1] ?? null;

  if (activeGroupId) {
    const group = data.groupMemberships.find((m) => m.groupId === activeGroupId);
    return <GroupSidebarNav groupId={activeGroupId} groupName={group?.groupName ?? activeGroupId} />;
  }

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

      <NavLink href="/request" icon={<HelpCircle className="h-4 w-4" />}>
        Request Help
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

      <div className="mt-2 pt-2">
        <NavLink href="/request" icon={<UserRound className="h-4 w-4" />}>Find Groups</NavLink>
        <NavLink href="/dashboard#routes" icon={<Bell className="h-4 w-4" />} badge={unreadRouteCount}>
          Notifications
        </NavLink>
      </div>
    </nav>
  );
}

function GroupSidebarNav({ groupId, groupName }: { groupId: string; groupName: string }) {
  const base = `/groups/${groupId}`;

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4 gap-1">
      <Link
        href="/dashboard"
        className="nav-link mb-3 flex items-center gap-1.5 px-2 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        My Groups
      </Link>

      <p className="mb-2 px-2 text-sm font-semibold text-[var(--text)] truncate">{groupName}</p>

      <CollapsibleNavSection label="Coordination">
        <NavLink href={`${base}#activity`} icon={null} indent>Activity</NavLink>
        <NavLink href={`${base}#discussion`} icon={null} indent>Discussion</NavLink>
        <NavLink href={`${base}#bulletins`} icon={null} indent>Bulletins</NavLink>
        <NavLink href={`${base}#publications`} icon={null} indent>Publications</NavLink>
        <NavLink href={`${base}#documents`} icon={null} indent>Living Documents</NavLink>
      </CollapsibleNavSection>

      <CollapsibleNavSection label="Community">
        <NavLink href={`${base}#members`} icon={null} indent>Members</NavLink>
        <NavLink href={`${base}#projects`} icon={null} indent>Projects</NavLink>
        <NavLink href={`${base}#responsibilities`} icon={null} indent>Responsibilities</NavLink>
      </CollapsibleNavSection>

      <CollapsibleNavSection label="Governance">
        <NavLink href={`${base}#petitions`} icon={null} indent>Petitions</NavLink>
        <NavLink href={`${base}#contribution-categories`} icon={null} indent>Contribution Categories</NavLink>
        <NavLink href={`${base}#trusted-providers`} icon={null} indent>Trusted Providers</NavLink>
        <NavLink href={`${base}#governance`} icon={null} indent>Settings</NavLink>
      </CollapsibleNavSection>

      <CollapsibleNavSection label="Accountability">
        <NavLink href={`${base}#concerns`} icon={null} indent>Concerns</NavLink>
      </CollapsibleNavSection>
    </nav>
  );
}

function CollapsibleNavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between px-2 py-1.5 text-sm font-medium text-[var(--soft-text)] hover:text-[var(--text)] select-none">
        {label}
        <span className="text-[var(--muted)] group-open:hidden">▸</span>
        <span className="hidden text-[var(--muted)] group-open:inline">▾</span>
      </summary>
      {children}
    </details>
  );
}

function NavSection({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-2 px-2 pt-1.5 text-sm font-medium text-[var(--soft-text)]">
        {icon}
        {label}
      </p>
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
