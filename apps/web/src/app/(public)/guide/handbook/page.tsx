import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AlphaNotice } from "../../../../components/shared/Notice";

export const dynamic = "force-dynamic";

// The full Commons user's guide, rendered as styled prose. Linked from /guide. Kept faithful to the
// authored manual; the only edits to the source text are in "Asking for help" and "What Commons
// remembers" — calibrated to the real request-retention behaviour (sensitive content is redacted
// after the accountability window, rather than no record existing at all).

export default function HandbookPage() {
  return (
    <main className="flex-1 bg-[var(--page)] px-4 py-8 text-[var(--text)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <AlphaNotice />

        <Link href="/guide" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the Guide
        </Link>

        <header className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">User&apos;s Guide</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Commons — A User&apos;s Guide</h1>
          <p className="mt-4 text-base italic leading-7 text-[var(--soft-text)]">
            How to ask for help, offer help, and make decisions together — on a platform built so that no one
            quietly runs the place.
          </p>
        </header>

        <Section title="Before you start: what this guide is">
          <P>
            This is a plain-language guide to how Commons works and how to take part. Commons is in early testing
            (alpha), so a particular screen, button, or label on your community&apos;s node may look a little
            different from what&apos;s described here, and new things are still being added. When in doubt, the
            people in your community — and whoever set up your node — are the real authority on local specifics.
            Think of this as the map, not the territory.
          </P>
          <P>
            You don&apos;t need to read it all at once. The first two sections explain the ideas that make Commons
            unusual; after that, each section covers one thing you might want to do.
          </P>
        </Section>

        <Section title="What Commons is for">
          <P>
            Commons is the digital equivalent of a well-run neighborhood, organizing network, or co-op: a place to
            ask for help when you need it, offer help when you can, decide things together, and remember who pitched
            in — without the things that make most online platforms corrosive. There are no administrators with
            hidden power, no surveillance, no permanent record of your worst moments, no feed engineered to keep you
            scrolling, and no score that ranks you against everyone else.
          </P>
          <P>
            The whole project runs on one sentence: <Strong>make cooperation easier and domination harder.</Strong>{" "}
            And one promise worth saying plainly: Commons remembers <Em>who helped</Em> in full, but it does not keep
            a lasting, readable record of <Em>what you needed</Em>. Contributions are part of the community&apos;s
            shared history; the sensitive details of a request are redacted once they&apos;re no longer needed for
            accountability. That asymmetry — contribution kept, vulnerability erased — is deliberate, and it shapes
            everything else.
          </P>
        </Section>

        <Section title="The big ideas (read this first)">
          <P>
            Commons works differently from almost any platform you&apos;ve used. A handful of ideas explain the rest.
          </P>
          <P>
            <Strong>No admins. The group decides.</Strong> There is no owner-account that can approve, delete, or
            overrule. Anything that matters — adding a member, starting a project, giving someone a role, changing
            what a group shows the public — happens through a <Em>petition</Em>: a proposal the relevant group votes
            on. This is more work than clicking &ldquo;approve,&rdquo; and that&apos;s the point: authority comes from
            the group&apos;s consent, not from a privileged button.
          </P>
          <P>
            <Strong>The rules emerge; nobody sets them by hand.</Strong> There&apos;s no settings page where someone
            types in &ldquo;a proposal needs 60% to pass.&rdquo; Instead, each kind of decision has a{" "}
            <Em>temperature</Em> that the whole group nudges — toward &ldquo;be more careful&rdquo; or &ldquo;make it
            easier to act&rdquo; — and the system works out the actual thresholds and time limits from everyone&apos;s
            input. The rules a vote runs under are frozen the moment the vote opens, so they can&apos;t be moved
            mid-vote.
          </P>
          <P>
            <Strong>Authority is borrowed, never owned.</Strong> When the group gives someone a role — say, reviewing
            concerns, or handling communications — they hold it for a fixed term, and the group can take it back early
            through a <Em>recall</Em> if they misuse it or just aren&apos;t the right fit. No role is permanent, and no
            role makes someone &ldquo;in charge&rdquo; of ordinary members.
          </P>
          <P>
            <Strong>You&apos;re a person, not an account in a hierarchy.</Strong> Your <Em>collectives</Em> (the groups
            and projects you belong to) are spaces you drop into, not the thing you exist inside. Commons is organized
            around you and the threads you&apos;re part of.
          </P>
          <P>
            <Strong>Reversible by default.</Strong> Most decisions can be undone. A group made public can be made
            private again; a role can be recalled; an archived group can come back. Commons avoids one-way doors
            wherever it can.
          </P>
        </Section>

        <Section title="Finding your way around">
          <P>
            When you join a community&apos;s node, you apply — to the node, or to specific groups — and your
            application is something the group decides on. (Yes: even joining is a petition.) While it&apos;s pending,
            you can see it and withdraw it if you change your mind.
          </P>
          <P>
            Once you&apos;re in, your <Strong>home</Strong> is where you land. It pulls together what involves you
            across your spaces: the collectives you belong to, what&apos;s on the shared calendar, and anything that
            needs your attention. From there you drop into any one group to see it up close. Your home and your group
            pages together give you everything you&apos;re part of — the requests you&apos;ve made, the votes
            you&apos;re in, the roles you hold — without making you hunt through each space one at a time.
          </P>
          <P>
            Every group page shows you a <Strong>map of everything that group can do</Strong> — not just the parts
            you&apos;ve already used. This is on purpose: you can always see the full range of what&apos;s possible,
            including powers like recall that you may never have needed, so nothing about how the group works is hidden
            from you. You can tuck away the parts you don&apos;t want cluttering your view, but they stay one click
            away on the map. The system never hides them from you; only you can, and never for good.
          </P>
        </Section>

        <Section title="Asking for help">
          <P>
            This is the heart of Commons, and it&apos;s built to make asking feel safe rather than costly.
          </P>
          <P>
            When you need something — a ride, a meal, help moving, someone to talk to, a tool you don&apos;t own — you
            make a <Strong>request</Strong>. You don&apos;t have to justify it or prove you deserve it. Your request
            goes out to the active members of the relevant group, who can offer to help. Public groups can turn on
            free-text requests, so you can ask for anything in your own words, even before the group has organized
            itself into formal categories of help.
          </P>
          <P>
            Two things matter here. First, <Strong>your request&apos;s sensitive details don&apos;t linger.</Strong>{" "}
            Once a request is resolved and any accountability window has passed, the personal specifics — your contact
            information, your location, and the free-text description of what you asked for — are automatically
            erased. A minimal coordination record remains, but the vulnerable details of your ask don&apos;t follow
            you around as a mark of having struggled. Second, <Strong>no one is ranked by how much help they&apos;ve
            asked for.</Strong> There&apos;s no &ldquo;frequent asker&rdquo; label, no score that drops when you reach
            out. The system is built so that needing help never becomes a reputation.
          </P>
        </Section>

        <Section title="Offering help">
          <P>
            When you can pitch in, you make an <Strong>offer</Strong>, or you respond to someone&apos;s request. When
            you accept a request, Commons connects you with the person so you can coordinate the details directly. If
            something goes wrong — the situation isn&apos;t what you expected, or you&apos;re uncomfortable — you can
            flag the problem so the right people can look into it, without that turning into a public accusation
            against anyone.
          </P>
          <P>
            Helping is the thing Commons <Em>does</Em> remember. Your contributions are part of your standing in a
            community, in a good way — not as a number, but as a real history of having shown up.
          </P>
        </Section>

        <Section title="Deciding things together: petitions">
          <P>
            A petition is how a group makes any decision that matters. Someone proposes something — &ldquo;let&apos;s
            admit this new member,&rdquo; &ldquo;let&apos;s start a community-garden project,&rdquo; &ldquo;let&apos;s
            make this group&apos;s page public&rdquo; — and the group votes.
          </P>
          <P>A few things make Commons petitions different from a typical poll:</P>
          <Ul
            items={[
              <><Strong>The rules are fixed when the vote opens.</Strong> How many votes it needs and how long it stays open are settled the moment the petition is created, and written into it. Even if the group&apos;s mood shifts while the vote runs, the goalposts don&apos;t move.</>,
              <><Strong>Many petitions are reversible.</Strong> A lot of decisions can be run in both directions — if the group makes itself public and later regrets it, the same kind of vote can make it private again.</>,
              <><Strong>You can see the actual proposal.</Strong> When someone proposes a change with specific wording — a new bulletin, a renamed node — you see the proposed text itself before you vote, not just a vague description.</>,
            ]}
          />
          <P>
            Things that go through petitions include admitting or removing members, creating projects, giving someone
            a responsibility (and recalling it), publishing bulletins, changing a group&apos;s public/private status,
            declaring an emergency, appointing a node steward, and even renaming the whole node. The pattern is
            consistent: if it affects the group, the group decides.
          </P>
        </Section>

        <Section title="How the rules get set: temperature and signals">
          <P>
            Since no one types in the rules, where do they come from? From you and everyone else, continuously.
          </P>
          <P>
            For each kind of decision (membership, projects, responsibilities, accountability, and so on), you can
            cast a small <Strong>signal</Strong>: roughly &ldquo;we should be more careful about this&rdquo; (−1),
            &ldquo;no strong feeling&rdquo; (0), or &ldquo;this should be easier to do&rdquo; (+1). The system blends
            everyone&apos;s signals into a <Em>temperature</Em> for that category and works out the concrete settings
            from there — a more cautious temperature means a higher bar to pass and more time to deliberate; a warmer
            one means the opposite.
          </P>
          <P>
            You&apos;ll see plain-language labels for what each signal does — &ldquo;increase the threshold,&rdquo;
            &ldquo;shorten the time a petition stays open&rdquo; — rather than a vague dial. Your voice counts for more
            when you&apos;re active in the group and less when you&apos;ve drifted away, but it&apos;s never any single
            person&apos;s setting to control. The rules are the group&apos;s collective temperature, made visible.
          </P>
        </Section>

        <Section title="Roles, responsibilities, and recall">
          <P>
            Some work needs a particular person to be responsible for it — reviewing concerns, handling
            communications, coordinating a project. Commons calls these <Strong>responsibilities</Strong>, or seats,
            and a seat can carry specific <Strong>abilities</Strong> (the practical power to do that job).
          </P>
          <P>Three rules keep this from turning into a hierarchy:</P>
          <Ul
            items={[
              <><Strong>A seat is held for a term, not forever.</Strong> When the term ends, the ability ends with it — automatically.</>,
              <><Strong>The group can recall a seat-holder early.</Strong> If someone with a role is misusing it, or it&apos;s just not working, the group can vote to take the role back before the term is up. Commons was built so that you can&apos;t give someone real authority until the group can also revoke it — <Em>recall before authority</Em>.</>,
              <><Strong>Roles don&apos;t outrank members.</Strong> Holding a seat lets you act <Em>on behalf of that responsibility</Em> — it does not make you the boss of anyone. Every ordinary member can still do the ordinary things: take part in their group&apos;s spaces, ask for help, offer help. A couple of the most basic, equal actions are deliberately left open to everyone and never locked behind a role.</>,
            ]}
          />
        </Section>

        <Section title="Raising a concern">
          <P>
            If someone&apos;s conduct is a problem, you can raise a <Strong>concern</Strong>. This is the
            accountability side of Commons, and it&apos;s handled with care on every side.
          </P>
          <P>
            Several protections are built in. The person a concern is about <Strong>cannot be the one who reviews
            it</Strong> — that would defeat the point. If you raise a concern and later want to step back,{" "}
            <Strong>withdrawing doesn&apos;t automatically shut it down</Strong>: if there&apos;s a real safety issue,
            the people responsible for reviewing can carry on, because a concern isn&apos;t only about the person who
            raised it. And — importantly — <Strong>a concern is not a public scorecard.</Strong> Commons does not
            build a permanent, visible reputation out of the concerns attached to a person. It deliberately avoids
            turning accountability into the kind of follow-you-forever record the whole platform is designed to
            prevent.
          </P>
          <P>
            This is the harder, more sensitive part of mutual aid, and Commons tries to make it possible to address
            real problems without building a surveillance machine in the process.
          </P>
        </Section>

        <Section title="What Commons remembers — and what it doesn't">
          <P>This deserves its own section, because it&apos;s the thing that makes Commons trustworthy.</P>
          <P>
            <Strong>Commons remembers coordination and contribution.</Strong> Who&apos;s in a group, what was decided
            and under what rules, who took on which roles, who helped. This is the shared, accountable life of the
            community, and it&apos;s meant to be visible — that&apos;s what keeps power honest.
          </P>
          <P>
            <Strong>Commons does not archive your private life or your hardest moments.</Strong> When you ask for help,
            the sensitive details of your request — your contact information, your location, and what you asked for —
            are automatically erased once any accountability window has passed; only coarse coordination metadata
            remains. It does not score you. It does not rank you against others, and any trust you&apos;ve earned is{" "}
            <Em>local</Em> — it belongs to a particular community and doesn&apos;t follow you around as a portable
            number.
          </P>
          <P>
            <Strong>Private groups stay private.</Strong> A private group&apos;s existence isn&apos;t leaked on public
            pages — not its name, and not even a count of how many private groups exist. Private spaces don&apos;t
            appear in public lists, and a private group can&apos;t be put forward for roles (like node steward) that
            are meant to be transparent.
          </P>
          <P>
            The short version: the shared coordination of the community is visible and accountable; your personal life
            stays private and sovereign. Those two halves are the whole point.
          </P>
        </Section>

        <Section title="Coming and going: participation and catch-up">
          <P>
            Commons expects that people drift in and out — that&apos;s normal and fine. Your activity in each group is
            tracked lightly (essentially, whether you&apos;ve been around lately), and it&apos;s <Em>per-group</Em>:
            you might be active in one space and quiet in another.
          </P>
          <P>
            What this affects: how much you&apos;re eligible to weigh in on, how many notifications you get, and
            what&apos;s emphasized for you. What it <Strong>never</Strong> affects: your ability to find and get back
            to your spaces. You can always reach a group you belong to, no matter how long you&apos;ve been away —
            there are no doors that lock you out for being quiet. When you return to a space after time away, Commons
            can show you a short summary of what changed while you were gone, so you&apos;re not lost.
          </P>
        </Section>

        <Section title="If you host a node">
          <P>
            Hosting a Commons node — running an instance for your community — comes with one big thing to understand:{" "}
            <Strong>you host, but you don&apos;t rule.</Strong> Setting up the node doesn&apos;t make you its
            administrator in the usual sense. The same governance model that constrains everyone constrains you: you
            can&apos;t quietly approve things, set the rules by hand, or overrule the community. That isn&apos;t a
            limitation to work around — it&apos;s the entire idea.
          </P>
          <P>
            In practice, hosting gives you a few extra surfaces — for example, a place to receive feedback and bug
            reports from your members, which you can review and compile into a tidy, redacted record over time.
            Decisions that affect the whole node, rather than one group, use a two-step process: a group proposes
            something internally, and once that group agrees, it escalates to a vote of the whole node. This is how the
            community appoints (or recalls) a <Em>node steward</Em>, and how something as fundamental as the
            node&apos;s name gets changed — proposed by a group, then ratified by everyone.
          </P>
          <P>
            If you&apos;re hosting, the best thing you can do is resist the urge to be the boss. Commons works when the
            host is a caretaker of the infrastructure, not a ruler of the people on it.
          </P>
        </Section>

        <Section title="A few principles for using Commons well">
          <Ul
            items={[
              <><Strong>When in doubt, propose.</Strong> The real answer to &ldquo;who&apos;s allowed to do this?&rdquo; is usually &ldquo;the group, by petition.&rdquo; Proposing something isn&apos;t presumptuous — it&apos;s how the system is meant to work.</>,
              <><Strong>Trust is local.</Strong> Standing you&apos;ve built in one community is real, but it&apos;s not a portable score. Show up where you are.</>,
              <><Strong>You can always leave, disagree, or reshape.</Strong> You&apos;re never trapped: you can step back from a space, vote against the grain, or propose changing how things work. A healthy commons depends on people being able to do all three.</>,
              <><Strong>Simplicity is on purpose.</Strong> If Commons ever feels deliberately plain, that&apos;s a feature. Complexity is where hidden power likes to hide; keeping things legible keeps them fair.</>,
            ]}
          />
        </Section>

        <section className="border border-[var(--border)] bg-[var(--subtle)] p-5 sm:p-6">
          <p className="text-sm italic leading-7 text-[var(--soft-text)]">
            Commons is a tool for people looking after each other. Everything in it is built to make that easier — and
            to make sure that no one, including whoever runs it, can quietly turn it into something else.
          </p>
        </section>

        <Link href="/guide" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--text)]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the Guide
        </Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-7 text-[var(--soft-text)]">{children}</p>;
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-[var(--text)]">{children}</strong>;
}

function Em({ children }: { children: React.ReactNode }) {
  return <em className="text-[var(--text)]">{children}</em>;
}

function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-3 space-y-2.5 text-sm leading-7 text-[var(--soft-text)]">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-2.5 h-1.5 w-1.5 shrink-0 bg-[var(--accent)]" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
