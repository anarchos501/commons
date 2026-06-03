import Link from "next/link";
import { HandHeart, HelpCircle, LogIn, UserPlus } from "lucide-react";
import { getSession } from "../lib/session";
import { redirect } from "next/navigation";

function AlphaNotice() {
  return (
    <div
      className="rounded-md border border-[var(--notice-border)] bg-[var(--notice)] px-4 py-3 text-sm text-[var(--notice-text)]"
      role="status"
    >
      <p className="font-medium">Commons Open Alpha</p>
      <div className="mt-0.5">
        Experimental software — not for sensitive real-world use yet.{" "}
        <details className="mt-1">
          <summary className="cursor-pointer underline-offset-2 hover:underline">Alpha limits</summary>
          <div className="mt-2 space-y-1 text-xs leading-5">
            <p>Do not use for medical emergencies, legal emergencies, private organizing, or confidential information.</p>
            <p>Alpha data is plaintext and visible to the server operator. No end-to-end encryption exists yet.</p>
            <p>This version is intended for hypothetical testing, architecture review, and governance feedback.</p>
          </div>
        </details>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const session = await getSession();

  if (session.accountId) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-16 sm:px-6">
        <header className="flex flex-col gap-4">
          <p className="text-sm font-medium text-[var(--muted)]">Northside Commons</p>
          <h1 className="text-4xl font-semibold tracking-normal text-[var(--text)] sm:text-5xl">
            Ask for help.<br />Offer help.<br />Keep it human.
          </h1>
          <p className="mt-2 max-w-lg text-base leading-7 text-[var(--soft-text)]">
            Commons helps a group connect needs with people who can help — without turning private hardship into public history.
          </p>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/request"
            className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-5 py-3 text-sm font-medium text-[var(--accent-text)] transition hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
            Request Support
          </Link>
          <Link
            href="/login"
            className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-5 py-3 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Login
          </Link>
          <Link
            href="/register"
            className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-5 py-3 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Create Account
          </Link>
        </div>

        <AlphaNotice />

        <div className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-5 text-sm leading-7 text-[var(--soft-text)]">
          <div className="flex items-center gap-2 font-medium text-[var(--text)]">
            <HandHeart className="h-4 w-4" aria-hidden="true" />
            No account needed to ask for help
          </div>
          <p className="mt-2">
            Requesting support requires only what is needed for coordination — what kind of help, how to reach you, and how soon. No registration, no permanent record of vulnerability.
          </p>
        </div>
      </section>
    </main>
  );
}
