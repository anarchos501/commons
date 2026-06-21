"use client";

import { useState } from "react";
import Link from "next/link";
import type { SidebarData } from "../lib/sidebar-data";
import { Sidebar } from "./sidebar/Sidebar";
import { GuestSidebar } from "./sidebar/GuestSidebar";
import { SidebarTriggerButton } from "./sidebar/SidebarTriggerButton";
import { FeedbackLink } from "./FeedbackLink";

interface Props {
  sidebarData: SidebarData | null;
  isAuthenticated: boolean;
  children: React.ReactNode;
}

export function PublicShell({ sidebarData, isAuthenticated, children }: Props) {
  const [open, setOpen] = useState(false);
  const openSidebar = () => setOpen(true);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center">
          {/* Left: mobile navigation and guide */}
          <div className="flex flex-1 items-center gap-1">
            <SidebarTriggerButton onOpen={openSidebar} />
            <Link
              href="/guide"
              className="text-xs font-medium text-[var(--muted)] hover:text-[var(--accent)] sm:text-sm"
            >
              Guide
            </Link>
          </div>

          <Link
            href={isAuthenticated ? "/dashboard" : "/"}
            className="text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] transition-colors"
          >
            Commons
          </Link>

          <div className="flex flex-1 justify-end">
            <FeedbackLink className="text-xs text-[var(--muted)] hover:text-[var(--accent)]" />
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {sidebarData ? (
          <Sidebar data={sidebarData} open={open} onClose={() => setOpen(false)} />
        ) : (
          <GuestSidebar open={open} onClose={() => setOpen(false)} />
        )}
        <div className="flex flex-1 flex-col min-w-0 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
