import Link from "next/link";
import { Home, LogIn, UserRound } from "lucide-react";
import { SidebarShell } from "./SidebarShell";
import { ThemeToggle } from "../theme/ThemeToggle";
import { TextSizeToggle } from "../theme/TextSizeToggle";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function GuestSidebar({ open, onClose }: Props) {
  return (
    <SidebarShell open={open} onClose={onClose}>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        <GuestNavLink href="/" icon={<Home className="h-4 w-4" />}>
          Home
        </GuestNavLink>
        <GuestNavLink href="/groups" icon={<UserRound className="h-4 w-4" />}>
          Find Collectives
        </GuestNavLink>
      </nav>

      <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-3">
        <span className="truncate text-xs text-[var(--muted)]">Guest</span>
        <div className="guest-sidebar-actions flex shrink-0 items-center gap-1">
          <TextSizeToggle />
          <ThemeToggle />
          <Link
            href="/login"
            className="btn-icon flex items-center gap-1.5 px-2 py-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            <LogIn className="h-3.5 w-3.5" />
            Log In
          </Link>
        </div>
      </div>
    </SidebarShell>
  );
}

function GuestNavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="nav-link flex items-center gap-2 px-2 py-1.5 text-sm text-[var(--soft-text)] hover:text-[var(--text)]"
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
    </Link>
  );
}
