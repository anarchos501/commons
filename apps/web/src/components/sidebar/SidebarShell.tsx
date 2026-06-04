"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function SidebarShell({ open, onClose, children }: Props) {
  return (
    <>
      {/* Sidebar panel */}
      <aside
        id="commons-mobile-navigation"
        className={`
          sidebar-panel
          fixed top-0 bottom-0 left-0 z-50 w-[min(20rem,100vw)] h-[100dvh] max-h-[100dvh] flex flex-col bg-[var(--surface)] border-r border-[var(--border)]
          transition-transform duration-200
          lg:static lg:h-auto lg:max-h-none lg:flex lg:pointer-events-auto
        `}
        data-open={open ? "true" : "false"}
      >
        <div className="flex items-center justify-between px-4 py-3 lg:hidden">
          <span className="text-sm font-semibold text-[var(--text)]">Commons</span>
          <a
            href="#"
            onClick={onClose}
            aria-label="Close navigation"
            role="button"
            className="flex items-center justify-center min-h-[44px] min-w-[44px] hover:bg-[var(--hover)] text-[var(--muted)]"
          >
            <X className="h-5 w-5" />
          </a>
        </div>
        {children}
      </aside>

      <a
        href="#"
        className={`${open ? "block" : "sidebar-target-overlay"} lg:hidden fixed inset-0 z-40 bg-black/40`}
        onClick={onClose}
        aria-label="Close navigation"
      />
    </>
  );
}
