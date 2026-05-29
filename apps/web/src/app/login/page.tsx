import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createPrismaClient } from "../../lib/prisma";
import { getSession } from "../../lib/session";
import { loginAccount } from "../../lib/auth";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
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
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Sign in</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
            No account yet?{" "}
            <Link href="/register" className="font-medium text-[var(--accent)] hover:underline">
              Create one
            </Link>{" "}
            or{" "}
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

        <form action={loginAction} className="flex flex-col gap-5 rounded-md border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
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
            className="min-h-11 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-text)] transition hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
          >
            Sign in
          </button>
        </form>
      </section>
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
