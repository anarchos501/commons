"use client";

import { X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

interface Props {
  trigger: ReactNode;
  children: ReactNode;
}

export function SidebarShell({ trigger, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile trigger */}
      <div className="lg:hidden fixed top-0 left-0 z-40 p-3" onClick={() => setOpen(true)}>
        {trigger}
      </div>

      {/* Overlay */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-[var(--surface)] border-r border-[var(--border)]
          transition-transform duration-200
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:static lg:translate-x-0 lg:flex
        `}
      >
        <div className="flex items-center justify-between px-4 py-3 lg:hidden">
          <span className="text-sm font-semibold text-[var(--text)]">Commons</span>
          <button onClick={() => setOpen(false)} aria-label="Close navigation" className="btn-icon p-1 hover:bg-[var(--hover)]">
            <X className="h-4 w-4 text-[var(--muted)]" />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
