"use client";

import { useState } from "react";
import Link from "next/link";
import type { SidebarData } from "../lib/sidebar-data";
import { Sidebar } from "./sidebar/Sidebar";
import { SidebarTriggerButton } from "./sidebar/SidebarTriggerButton";

interface Props {
  sidebarData: SidebarData;
  children: React.ReactNode;
}

export function AppShell({ sidebarData, children }: Props) {
  const [open, setOpen] = useState(false);
  const openSidebar = () => setOpen(true);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center">
          {/* Left: hamburger on mobile, empty spacer on desktop */}
          <div className="flex flex-1 items-center">
            <SidebarTriggerButton onOpen={openSidebar} />
          </div>

          <Link
            href="/dashboard"
            className="text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] transition-colors"
          >
            Commons
          </Link>

          <div className="flex-1" />
        </div>
      </header>

      <div className="flex flex-1">
        <Sidebar data={sidebarData} open={open} onClose={() => setOpen(false)} />
        <div className="flex flex-1 flex-col min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
