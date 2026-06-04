"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    document.cookie = `commons_theme=${next ? "dark" : "light"}; path=/; max-age=31536000; SameSite=Lax`;
    setIsDark(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="btn-icon flex items-center gap-1.5 px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
    >
      {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      {isDark ? "Light" : "Dark"}
    </button>
  );
}
