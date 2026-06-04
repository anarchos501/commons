import Link from "next/link";
import { HandHeart, HelpCircle, LogIn, Shield, Users, UserPlus } from "lucide-react";
import { getSession } from "../../lib/session";
import { redirect } from "next/navigation";
import { AlphaNotice } from "../../components/shared/Notice";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const session = await getSession();
  if (session.accountId) redirect("/dashboard");

  return (
    <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">

        <AlphaNotice />

        <div className="mt-8 grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">

          {/* Left — hero copy */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">Northside Commons</p>
            <h1 className="mt-4 text-5xl font-bold tracking-tight leading-[1.05] sm:text-6xl">
              Share.<br />Collaborate.<br />Connect.
            </h1>
            <p className="mt-5 text-base leading-7 text-[var(--soft-text)]">
              Commons helps a community connect needs with people who can provide support — without turning private hardship into public history.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/request"
                className="btn-primary flex min-h-14 flex-1 items-center justify-center gap-2 bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
              >
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
                Request Support
              </Link>
              <Link
                href="/login"
                className="btn-secondary flex min-h-14 flex-1 items-center justify-center gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-5 py-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Login
              </Link>
              <Link
                href="/register"
                className="btn-secondary flex min-h-14 flex-1 items-center justify-center gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-5 py-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Create Account
              </Link>
            </div>
          </div>

          {/* Right — feature cards */}
          <div className="flex flex-col gap-4">
            <div className="border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                <HelpCircle className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                No account needed to request support
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
                Requesting support requires only what is needed for coordination — what kind of support, how to reach you, and how soon. No registration, no permanent record of vulnerability.
              </p>
            </div>

            <div className="border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                <Users className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                Community-governed groups
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
                Groups coordinate their own services, responsibilities, and decisions. Members can offer support, take on roles, and shape how the group runs together.
              </p>
            </div>

            <div className="border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                <Shield className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                Privacy by design
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
                Contact details are shared only after someone accepts to provide support, and are removed once a request expires or is fulfilled. Contribution summaries never name who received support.
              </p>
            </div>

            <div className="border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                <HandHeart className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                Trusted contributors
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
                Groups can recognize trusted contributors for specific services. Requesters can choose whether that recognition matters to them.
              </p>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
