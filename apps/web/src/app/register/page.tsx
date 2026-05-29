import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createPrismaClient } from "../../lib/prisma";
import { getSession } from "../../lib/session";
import { registerAccount } from "../../lib/auth";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();

  if (session.accountId) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
        <header>
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Northside Commons
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Create an account</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
            Already have one?{" "}
            <Link href="/login" className="font-medium text-[var(--accent)] hover:underline">
              Sign in
            </Link>
            . Or{" "}
            <Link href="/request" className="font-medium text-[var(--accent)] hover:underline">
              request support without an account
            </Link>
            .
          </p>
        </header>

        {error ? (
          <div className="rounded-md border border-[var(--notice-border)] bg-[var(--notice)] px-4 py-3 text-sm text-[var(--notice-text)]" role="alert">
            {error}
          </div>
        ) : null}

        <form action={registerAction} className="flex flex-col gap-5 rounded-md border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
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
          <div className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-3 text-xs leading-5 text-[var(--soft-text)]">
            Commons stores only what is needed for coordination. Your email is used for login and is not shared outside this node.
          </div>
          <button
            type="submit"
            className="min-h-11 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-text)] transition hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
          >
            Create account
          </button>
        </form>
      </section>
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
    const sessionData = await registerAccount(prisma, {
      email: email.trim(),
      displayName: displayName.trim(),
      password,
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
