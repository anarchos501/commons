import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { getSession } from "../../lib/session";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const isAuthenticated = !!session.accountId;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center">
          <div className="flex-1" />
          <Link
            href={isAuthenticated ? "/dashboard" : "/"}
            className="text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] transition-colors"
          >
            Commons
          </Link>
          <div className="flex flex-1 justify-end">
          <nav className="flex items-center gap-2">
            <Link
              href="/request"
              className="btn-primary flex items-center gap-1.5 bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--surface)]"
            >
              <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Request Help
            </Link>
            {isAuthenticated ? (
              <Link
                href="/dashboard"
                className="btn-secondary border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--surface)]"
              >
                My Dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                className="btn-secondary border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--surface)]"
              >
                Login
              </Link>
            )}
          </nav>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
