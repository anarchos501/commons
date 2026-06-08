import Link from "next/link";
import { redirect } from "next/navigation";
import { HandHeart, Shield, Users } from "lucide-react";
import { createPrismaClient } from "../../../lib/prisma";
import { currentRequestHost } from "../../../lib/node-context";
import { getSession } from "../../../lib/session";
import { registerAccount } from "../../../lib/auth";
import { AlphaNotice } from "../../../components/shared/Notice";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (session.accountId) redirect("/dashboard");

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <AlphaNotice />

        <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_420px] lg:items-start">

          {/* Left — branding panel */}
          <div className="hidden lg:block">
            <Link href="/" className="text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] transition-colors">
              ← Commons
            </Link>
            <h1 className="mt-6 text-4xl font-bold tracking-tight">
              Join your<br />community.
            </h1>
            <p className="mt-4 text-base leading-7 text-[var(--soft-text)]">
              A member account lets you offer support, participate in group decisions, and build a record of contribution — all on your own terms.
            </p>
            <ul className="mt-8 space-y-4">
              {[
                { icon: HandHeart, text: "Offer your skills and availability to people who need them" },
                { icon: Users, text: "Join groups, take on responsibilities, and shape how your community is governed" },
                { icon: Shield, text: "Your data belongs to your community — not a platform" },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-sm text-[var(--soft-text)]">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {/* Right — form */}
          <div>
            {/* Mobile back link */}
            <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)] lg:hidden">
              ← Commons
            </Link>

            <div className="border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <h2 className="text-2xl font-bold tracking-tight">Create an account</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
                Already have one?{" "}
                <Link href="/login" className="font-medium text-[var(--accent)] hover:underline">Sign in</Link>
                . Or{" "}
                <Link href="/request" className="font-medium text-[var(--accent)] hover:underline">request support without an account</Link>.
              </p>

              {error && (
                <div className="mt-4 notice-bar px-4 py-3 text-sm text-[var(--notice-text)]" role="alert">
                  {error}
                </div>
              )}

              <form action={registerAction} className="mt-5 flex flex-col gap-5">
                <label className="block">
                  <span className="field-label">Display name</span>
                  <input name="displayName" type="text" className="field-input" autoComplete="name" required />
                  <p className="mt-1 text-xs text-[var(--muted)]">This is how you appear to group members. First name is fine.</p>
                </label>
                <label className="block">
                  <span className="field-label">Email</span>
                  <input name="email" type="email" className="field-input" autoComplete="email" required />
                </label>
                <label className="block">
                  <span className="field-label">Password</span>
                  <input name="password" type="password" className="field-input" autoComplete="new-password" minLength={8} required />
                  <p className="mt-1 text-xs text-[var(--muted)]">At least 8 characters.</p>
                </label>
                <div className="border border-[var(--border)] bg-[var(--subtle)] p-3 text-xs leading-5 text-[var(--soft-text)]">
                  Commons stores only what is needed for coordination. Your email is used for login and is not shared outside this node.
                </div>
                <button
                  type="submit"
                  className="btn-primary min-h-11 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
                >
                  Create account
                </button>
              </form>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}

async function registerAction(formData: FormData) {
  "use server";

  const displayName = formData.get("displayName");
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof displayName !== "string" || !displayName.trim() ||
    typeof email !== "string" || !email.trim() ||
    typeof password !== "string" || password.length < 8
  ) {
    redirect("/register?error=Please+fill+in+all+fields.+Password+must+be+at+least+8+characters.");
  }

  const prisma = createPrismaClient();
  try {
    const requestHost = await currentRequestHost();
    const sessionData = await registerAccount(prisma, {
      email: email.trim(),
      displayName: displayName.trim(),
      password,
      requestHost,
    });
    const session = await getSession();
    Object.assign(session, sessionData);
    await session.save();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Registration failed. Please try again.";
    redirect(`/register?error=${encodeURIComponent(message)}`);
  } finally {
    await prisma.$disconnect();
  }

  redirect("/dashboard");
}
