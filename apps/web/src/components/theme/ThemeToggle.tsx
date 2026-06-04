import { Moon } from "lucide-react";
import { toggleThemeAction } from "../../lib/theme-action";

export function ThemeToggle() {
  return (
    <form action={toggleThemeAction}>
      <button
        type="submit"
        aria-label="Toggle color theme"
        className="btn-icon flex items-center gap-1.5 px-2 py-1.5 touch-manipulation text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] active:bg-[var(--hover)]"
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        <Moon className="h-3.5 w-3.5" />
        Theme
      </button>
    </form>
  );
}
