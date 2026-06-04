"use client";

import { Menu } from "lucide-react";

interface Props {
  onOpen: () => void;
}

export function SidebarTriggerButton({ onOpen }: Props) {
  return (
    <a
      href="#commons-mobile-navigation"
      className="relative z-[60] lg:hidden flex items-center justify-center min-h-[48px] min-w-[48px] -ml-2 touch-manipulation cursor-pointer select-none text-[var(--text)] hover:bg-[var(--hover)] active:bg-[var(--hover)]"
      onClick={onOpen}
      aria-label="Open navigation"
      role="button"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <Menu className="h-6 w-6 pointer-events-none" aria-hidden="true" />
    </a>
  );
}
