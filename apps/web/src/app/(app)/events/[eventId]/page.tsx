import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createPrismaClient } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/session";
import { cancelEvent, getEventForViewer, getMyInterests, setInterest } from "../../../../lib/events";
import type { EventInterestLevel } from "../../../../generated/prisma/enums";
import { LocalTime } from "../../../../components/shared/LocalTime";
import { EventInterestButtons } from "../../../../components/shared/EventInterestButtons";

export const dynamic = "force-dynamic";

const HOST_PATH: Record<string, string | null> = {
  group: "/groups",
  project: "/projects",
  responsibility: "/responsibilities",
  coalition: "/coalitions",
  account: null,
};

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const session = await getSession();
  if (!session.accountId) redirect("/login");
  const accountId = session.accountId;

  const prisma = createPrismaClient();
  let event;
  let myLevel: string | undefined;
  try {
    event = await getEventForViewer(prisma, accountId, eventId);
    if (!event) notFound();
    const mine = await getMyInterests(prisma, accountId, [eventId]);
    myLevel = mine.get(eventId);
  } finally {
    await prisma.$disconnect();
  }

  async function setInterestAction(formData: FormData) {
    "use server";
    const s = await getSession();
    if (!s.accountId) redirect("/login");
    const raw = formData.get("level");
    const level = raw === "planning_to_attend" || raw === "interested" ? (raw as EventInterestLevel) : null;
    const prismaClient = createPrismaClient();
    try {
      await setInterest(prismaClient, { accountId: s.accountId, eventId, level });
    } finally {
      await prismaClient.$disconnect();
    }
    revalidatePath(`/events/${eventId}`);
  }

  async function cancelEventAction() {
    "use server";
    const s = await getSession();
    if (!s.accountId) redirect("/login");
    const prismaClient = createPrismaClient();
    try {
      await cancelEvent(prismaClient, { accountId: s.accountId, eventId });
    } finally {
      await prismaClient.$disconnect();
    }
    revalidatePath(`/events/${eventId}`);
  }

  const hostPath = HOST_PATH[event.hostType];
  const isMeeting = event.category === "meeting";

  return (
    <main className="flex-1 bg-[var(--page)] px-4 py-6 text-[var(--text)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href="/dashboard#calendar" className="text-sm text-[var(--soft-text)] hover:underline">← Back to calendar</Link>

        <div className="border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
          <span
            className={
              "inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
              (isMeeting ? "bg-[var(--accent)] text-[var(--accent-text)]" : "border border-[var(--border-strong)] text-[var(--muted)]")
            }
          >
            {isMeeting ? "Meeting" : "Workshop"}
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{event.title}</h1>

          {event.canceledAt && (
            <p className="mt-2 inline-block bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">This event was canceled.</p>
          )}

          <dl className="mt-4 space-y-1 text-sm text-[var(--soft-text)]">
            <div>
              <span className="text-[var(--muted)]">When: </span>
              <LocalTime value={event.startTime.toISOString()} />
              {" – "}
              <LocalTime value={event.endTime.toISOString()} options={{ hour: "numeric", minute: "2-digit" }} />
              <span className="text-[var(--muted)]"> ({event.timezone})</span>
            </div>
            <div>
              <span className="text-[var(--muted)]">Host: </span>
              {hostPath ? (
                <Link href={`${hostPath}/${event.hostId}`} className="hover:underline">{event.hostLabel}</Link>
              ) : (
                <span>{event.hostLabel}</span>
              )}
            </div>
            {event.location && (
              <div>
                <span className="text-[var(--muted)]">Where: </span>
                {event.location}
              </div>
            )}
          </dl>

          {event.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[var(--text)]">{event.description}</p>
          )}

          {event.authorizingPetitionId && (
            <p className="mt-4 text-xs text-[var(--muted)]">This meeting was authorized by a collective petition.</p>
          )}

          {!event.canceledAt && (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Planning signals</p>
              <EventInterestButtons eventId={event.id} current={myLevel} counts={event.interestCounts} action={setInterestAction} />
            </div>
          )}

          {!event.canceledAt && event.createdByAccountId === accountId && (
            <form action={cancelEventAction} className="mt-4">
              <button type="submit" className="text-xs text-red-600 hover:underline">Cancel this event</button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
