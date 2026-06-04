"use client";

import { useState } from "react";
import Link from "next/link";
import type { SidebarData } from "../lib/sidebar-data";
import { Sidebar } from "./sidebar/Sidebar";
import { SidebarTriggerButton } from "./sidebar/SidebarTriggerButton";

interface Props {
  sidebarData: SidebarData | null;
  isAuthenticated: boolean;
  children: React.ReactNode;
}

export function PublicShell({ sidebarData, isAuthenticated, children }: Props) {
  const [open, setOpen] = useState(false);
  const openSidebar = () => setOpen(true);

  return (
    <div className="flex flex-col min-h-full">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center">
          {/* Left: hamburger on mobile when authenticated, empty spacer otherwise */}
          <div className="flex flex-1 items-center">
            {sidebarData && (
              <SidebarTriggerButton onOpen={openSidebar} />
            )}
          </div>

          <Link
            href={isAuthenticated ? "/dashboard" : "/"}
            className="text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] transition-colors"
          >
            Commons
          </Link>

          <div className="flex-1" />
        </div>
      </header>

      <div className="flex flex-1">
        {sidebarData && (
          <Sidebar data={sidebarData} open={open} onClose={() => setOpen(false)} />
        )}
        <div className="flex flex-1 flex-col min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
