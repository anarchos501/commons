import { createPrismaClient } from "./prisma";
import type { EventHostType } from "../generated/prisma/enums";
import {
  getCalendarFilterPreferences,
  getMyInterests,
  listConnectableAudiences,
  listEventsForAccount,
  listEventsForSpace,
  serializeEvents,
  type CalendarEventClientView,
  type ResolvedCalendarFilters,
} from "./events";

export type ConnectableAudience = { audienceType: EventHostType; audienceId: string; label: string };

export type SpaceCalendarData = {
  events: CalendarEventClientView[];
  myInterests: Record<string, string>;
  audiences: ConnectableAudience[];
};

/** Loads one space's calendar (for the four space pages), opening its own prisma client. */
export async function loadSpaceCalendarData(
  accountId: string | null,
  hostType: EventHostType,
  hostId: string,
): Promise<SpaceCalendarData> {
  const prisma = createPrismaClient();
  try {
    const views = await listEventsForSpace(prisma, accountId, hostType, hostId);
    const [interests, audiences] = await Promise.all([
      accountId ? getMyInterests(prisma, accountId, views.map((v) => v.id)) : Promise.resolve(new Map<string, string>()),
      listConnectableAudiences(prisma, hostType, hostId),
    ]);
    return {
      events: serializeEvents(views),
      myInterests: Object.fromEntries(interests),
      audiences,
    };
  } finally {
    await prisma.$disconnect();
  }
}

export type DashboardCalendarData = {
  events: CalendarEventClientView[];
  myInterests: Record<string, string>;
  filters: ResolvedCalendarFilters;
};

/** Loads the aggregated personal dashboard calendar, opening its own prisma client. */
export async function loadDashboardCalendarData(accountId: string): Promise<DashboardCalendarData> {
  const prisma = createPrismaClient();
  try {
    const filters = await getCalendarFilterPreferences(prisma, accountId);
    const views = await listEventsForAccount(prisma, accountId, filters);
    const interests = await getMyInterests(prisma, accountId, views.map((v) => v.id));
    return {
      events: serializeEvents(views),
      myInterests: Object.fromEntries(interests),
      filters,
    };
  } finally {
    await prisma.$disconnect();
  }
}
