"use client";

// UI terminology note: "Collective" is the user-facing label for what the codebase calls a "Group".
// Code variables (groupId, GroupMembership, etc.), URLs (/groups/...), and DB fields are unchanged.

import Link from "next/link";
import { Briefcase, CircleDot, LayoutDashboard, MessageSquareWarning, Network, Shield, UserRound, Users } from "lucide-react";
import type { SidebarData } from "../../lib/sidebar-data";

interface Props {
  data: SidebarData;
}

export function SidebarNavClient({ data }: Props) {
  return <GlobalSidebarNav data={data} />;
}

function GlobalSidebarNav({ data }: { data: SidebarData }) {
  const { groupMemberships, projectMemberships, coalitionMemberships, canAccessNodeGovernance, canManageFeedback, responsibilityAssignments, unreadRouteCount } = data;

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4 gap-1">
      <NavLink href="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />} badge={unreadRouteCount}>
        Dashboard
      </NavLink>
      {canManageFeedback && (
        <NavLink href="/node/feedback" icon={<MessageSquareWarning className="h-4 w-4" />}>
          Feedback Inbox
        </NavLink>
      )}

      {groupMemberships.length > 0 && (
        <>
          <p className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-[var(--soft-text)]">
            <Users className="h-3.5 w-3.5" />
            My Collectives
          </p>
          {groupMemberships.map((m) => (
            <NavLink key={m.groupId} href={`/groups/${m.groupId}`} icon={null} indent>
              {m.groupName}
            </NavLink>
          ))}
        </>
      )}

      {projectMemberships.length > 0 && (
        <>
          <p className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-[var(--soft-text)]">
            <Briefcase className="h-3.5 w-3.5" />
            My Projects
          </p>
          {projectMemberships.map((m) => (
            <NavLink key={m.projectId} href={`/projects/${m.projectId}`} icon={null} indent>
              {m.projectName}
            </NavLink>
          ))}
        </>
      )}

      {coalitionMemberships.length > 0 && (
        <>
          <p className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-[var(--soft-text)]">
            <Network className="h-3.5 w-3.5" />
            My Coalitions
          </p>
          {coalitionMemberships.map((coalition) => (
            <NavLink key={coalition.coalitionId} href={`/coalitions/${coalition.coalitionId}`} icon={null} indent>
              {coalition.coalitionName}
            </NavLink>
          ))}
        </>
      )}

      {responsibilityAssignments.length > 0 && (
        <>
          <p className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-[var(--soft-text)]">
            <Shield className="h-3.5 w-3.5" />
            My Responsibilities
          </p>
          {responsibilityAssignments.map((r) => (
            <NavLink key={r.responsibilityId} href={`/responsibilities/${r.responsibilityId}`} icon={null} indent>
              {r.type.charAt(0).toUpperCase() + r.type.slice(1)}
            </NavLink>
          ))}
        </>
      )}

      <NavLink href="/groups" icon={<UserRound className="h-4 w-4" />}>Find Collectives</NavLink>
      {canAccessNodeGovernance && (
        <NavLink href="/node" icon={<CircleDot className="h-4 w-4" />}>
          Node Governance
        </NavLink>
      )}
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
