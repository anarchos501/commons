import Link from "next/link";
import {
  Activity,
  BookOpen,
  Briefcase,
  HandHeart,
  HelpCircle,
  Network,
  Shield,
  Users,
  Vote,
} from "lucide-react";
import { AlphaNotice } from "../../../components/shared/Notice";
import { getSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

const concepts = [
  {
    title: "Groups",
    icon: Users,
    body: "Groups are the main gathering places. You can join an existing group or create one for your neighborhood, crew, working group, or mutual aid circle.",
  },
  {
    title: "Projects",
    icon: Briefcase,
    body: "Projects are for a specific piece of shared work, like a garden, ride network, supply table, repair day, or organizing effort.",
  },
  {
    title: "Responsibilities",
    icon: Shield,
    body: "Responsibilities are roles people agree to hold for a while. They should be clear, temporary, and easy for others to understand.",
  },
  {
    title: "Petitions",
    icon: Vote,
    body: "Petitions are proposals for group decisions. People who are allowed to decide can support them, and the page shows when the decision closes.",
  },
  {
    title: "Coalitions",
    icon: Network,
    body: "Coalitions let groups work together without merging into one group. Each group keeps its own members and its own say.",
  },
  {
    title: "Node hosts",
    icon: BookOpen,
    body: "A node is one local Commons site. Node hosts help care for the site, but they do not own the community.",
  },
];

const alphaTests = [
  "Ask for support without making an account, then follow the status link.",
  "Create a group, invite people, and try changing a group setting through a petition.",
  "Offer a kind of support, change your availability, and check whether request routing still feels respectful.",
  "Create a project, request to join it from another account, then approve or dismiss the request.",
  "Try a responsibility: volunteer, confirm the role, resign, or let it expire.",
  "Report confusing language, privacy concerns, broken pages, or anything that feels too hard to understand.",
];

export default async function GuidePage() {
  const session = await getSession();
  const isAuthenticated = Boolean(session.accountId);

  return (
    <main className="flex-1 bg-[var(--page)] px-4 py-8 text-[var(--text)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <AlphaNotice />

        <header className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">Commons Guide</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">A simple guide to Commons</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--soft-text)]">
            Commons helps people ask for help, offer help, work on projects, and make decisions together. It is
            here to support real relationships, not replace them. It is not a social network, a popularity contest,
            or a place where one hidden admin quietly controls everything.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            The basic idea is simple: make it easier to cooperate, make power easier to see, and ask people for
            less private information.
          </p>
        </header>

        <section className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
          <div className="flex items-center gap-2">
            <HandHeart className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
            <h2 className="text-xl font-semibold">Getting started</h2>
          </div>
          <ol className="mt-5 grid gap-4 sm:grid-cols-2">
            <GuideStep
              number="1"
              title="Ask for support"
              body="You do not need an account to ask for support. Say what kind of help is needed, how someone can reach you, and only the details people need to respond."
            />
            <GuideStep
              number="2"
              title="Join or create a group"
              body="Groups are where most ongoing work happens. You can join a group you know, look for one that fits, or create a new group for people you are organizing with."
            />
            <GuideStep
              number="3"
              title="Offer what you can"
              body="Choose the kinds of help you might be able to offer and set your availability. It is okay to be limited or unavailable. Offering help should not mean being on call."
            />
            <GuideStep
              number="4"
              title="Take part at your own pace"
              body="You can help with requests, join projects, take on a role for a while, or support proposals. You do not need to use every part of Commons right away."
            />
          </ol>
        </section>

        <section className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
          <h2 className="text-xl font-semibold">The main parts of Commons</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
            These words show up around the app. You can learn them as you go.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {concepts.map(({ title, icon: Icon, body }) => (
              <article key={title} className="border border-[var(--border)] bg-[var(--subtle)] p-4">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                  <h3 className="font-medium">{title}</h3>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Vote className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
              <h2 className="text-xl font-semibold">Governance, in plain language</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--soft-text)]">
              Governance means how a group makes shared choices. In Commons, many shared changes happen through
              petitions. A petition says what change is being proposed, who can support it, when it closes, and
              what happened. Group members decide group questions. Project members decide project questions.
              Coalition questions go back to the groups involved.
            </p>
          </article>

          <article className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
              <h2 className="text-xl font-semibold">Privacy and care</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--soft-text)]">
              Share only what people need to help coordinate. Try not to post private medical, legal, money, home,
              or family details unless they are truly needed. Commons should remember that people helped each
              other without making someone&apos;s hard moment into a permanent public story.
            </p>
          </article>
        </section>

        <section className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
            <h2 className="text-xl font-semibold">Activity status</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--soft-text)]">
            Commons pays attention to whether members seem active, quiet, or dormant. This is not a score or a
            judgment about someone&apos;s worth. It is a way to keep decisions and routing from depending on people
            who have not been around in a while.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <StatusCard title="Active" body="You have been around recently and can take part normally." />
            <StatusCard title="Quiet" body="You have been away for a while. Visiting again can bring you back." />
            <StatusCard title="Dormant" body="You have been away longer, so the app stops counting on you for active work." />
          </div>
        </section>

        <section className="border border-[var(--border)] bg-[var(--subtle)] p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Commons is still in Open Alpha</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--soft-text)]">
            Some parts may change, and you may find bugs or confusing wording. Commons does not yet provide
            password reset, email notifications, end-to-end encryption, federation, plugins, or offline mobile
            support. Use the feedback form to tell node hosts what happened, what you expected, or what would
            make the app easier and safer to use.
          </p>
          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <h3 className="text-sm font-semibold text-[var(--text)]">Good things to test</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--soft-text)]">
              {alphaTests.map((test) => (
                <li key={test} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-[var(--accent)]" />
                  <span>{test}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
            <h2 className="text-xl font-semibold">Where would you like to go?</h2>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {isAuthenticated ? (
              <>
                <ActionLink href="/dashboard" primary>Open dashboard</ActionLink>
                <ActionLink href="/groups">Find groups</ActionLink>
                <ActionLink href="/groups/new">Create a group</ActionLink>
                <ActionLink href="/feedback?path=%2Fguide">Report feedback</ActionLink>
              </>
            ) : (
              <>
                <ActionLink href="/request" primary>Request support</ActionLink>
                <ActionLink href="/groups">Find groups</ActionLink>
                <ActionLink href="/register">Create an account</ActionLink>
                <ActionLink href="/login">Log in</ActionLink>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function GuideStep({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3 border border-[var(--border)] bg-[var(--subtle)] p-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-[var(--accent)] text-sm font-semibold text-[var(--accent-text)]">
        {number}
      </span>
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-[var(--soft-text)]">{body}</p>
      </div>
    </li>
  );
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--subtle)] p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-[var(--soft-text)]">{body}</p>
    </div>
  );
}

function ActionLink({
  href,
  primary = false,
  children,
}: {
  href: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "btn-primary inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-hover)]"
          : "btn-secondary inline-flex min-h-11 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--hover)]"
      }
    >
      {children}
    </Link>
  );
}
