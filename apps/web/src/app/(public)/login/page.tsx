import Link from "next/link";
import { redirect } from "next/navigation";
import { HandHeart, Shield, Users } from "lucide-react";
import { createPrismaClient } from "../../../lib/prisma";
import { getSession } from "../../../lib/session";
import { loginAccount } from "../../../lib/auth";
import { AlphaNotice } from "../../../components/shared/Notice";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (session.accountId) redirect("/dashboard");

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="flex-1 bg-[var(--page)] text-[var(--text)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <AlphaNotice />

        <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_420px] lg:items-start">

          {/* Left — branding panel (hidden on mobile, visible on lg+) */}
          <div className="hidden lg:block">
            <Link href="/" className="text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)] transition-colors">
              ← Commons
            </Link>
            <h1 className="mt-6 text-4xl font-bold tracking-tight">
              Mutual aid,<br />organized simply.
            </h1>
            <p className="mt-4 text-base leading-7 text-[var(--soft-text)]">
              Commons helps communities coordinate support requests, recognize contributors, and govern together — without surveillance or extractive platforms.
            </p>
            <ul className="mt-8 space-y-4">
              {[
                { icon: HandHeart, text: "Request or offer support with no account required for requesters" },
                { icon: Users, text: "Coordinate within groups that you govern collectively" },
                { icon: Shield, text: "Privacy-first — contact details are never stored longer than needed" },
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
              <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
                No account yet?{" "}
                <Link href="/register" className="font-medium text-[var(--accent)] hover:underline">Create one</Link>
                {" "}or{" "}
                <Link href="/request" className="font-medium text-[var(--accent)] hover:underline">request support without an account</Link>.
              </p>

              {error && (
                <div className="mt-4 notice-bar px-4 py-3 text-sm text-[var(--notice-text)]" role="alert">
                  {error}
                </div>
              )}

              <form action={loginAction} className="mt-5 flex flex-col gap-5">
                <label className="block">
                  <span className="field-label">Email</span>
                  <input name="email" type="email" className="field-input" autoComplete="email" required />
                </label>
                <label className="block">
                  <span className="field-label">Password</span>
                  <input name="password" type="password" className="field-input" autoComplete="current-password" required />
                </label>
                <button
                  type="submit"
                  className="btn-primary min-h-11 bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
                >
                  Sign in
                </button>
              </form>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}

async function loginAction(formData: FormData) {
  "use server";

  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    redirect("/login?error=Email+and+password+are+required.");
  }

  const prisma = createPrismaClient();
  try {
    const sessionData = await loginAccount(prisma, { email, password });
    const session = await getSession();
    Object.assign(session, sessionData);
    await session.save();
  } catch {
    redirect("/login?error=Invalid+email+or+password.");
  } finally {
    await prisma.$disconnect();
  }

  redirect("/dashboard");
}
