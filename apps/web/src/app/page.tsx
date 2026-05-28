import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Check,
  Clock,
  HandHeart,
  HeartHandshake,
  HelpCircle,
  Inbox,
  Languages,
  MapPin,
  Shield,
  X,
} from "lucide-react";
import { createPrismaClient } from "../lib/prisma";
import {
  createContributionFromAcceptedRoute,
  createSupportRequest,
  decideRequestRoute,
  declareServiceCapability,
  routeSupportRequest,
} from "../lib/capability-routing";

export const dynamic = "force-dynamic";

const serviceOptions = [
  { value: "rides", label: "Rides" },
  { value: "food delivery", label: "Food delivery" },
  { value: "translation", label: "Translation" },
  { value: "childcare", label: "Childcare" },
  { value: "repairs", label: "Repairs" },
  { value: "emotional support", label: "Emotional support" },
];

const sensitiveServices = new Set(["childcare"]);

const availabilityOptions = [
  {
    value: "available",
    label: "Available",
    description: "It is okay to route matching requests to me.",
  },
  {
    value: "limited",
    label: "Limited",
    description: "I may be able to help, but keep expectations light.",
  },
  {
    value: "time-sensitive-capable",
    label: "Time-sensitive capable",
    description: "I can sometimes help when timing matters, with no obligation implied.",
  },
  {
    value: "unavailable",
    label: "Unavailable",
    description: "Do not route new requests to me right now.",
  },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const notice = typeof params.notice === "string" ? params.notice : null;
  const data = await getExperienceData();

  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-medium text-[var(--muted)]">Northside Commons</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-[var(--text)] sm:text-4xl">
                Ask for help. Offer help. Keep it human.
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--soft-text)]">
                Commons helps a group connect needs with people who can help, without turning private hardship into public history.
              </p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-4 text-sm leading-6 text-[var(--soft-text)] md:w-72">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                <Shield className="h-4 w-4" aria-hidden="true" />
                Privacy first
              </div>
              <p className="mt-2">Help requests are shared only for coordination. Contribution summaries do not name who received help.</p>
            </div>
          </div>
          <nav aria-label="Primary actions" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <JumpLink href="#request" icon={<HelpCircle className="h-4 w-4" />}>
              Request Help
            </JumpLink>
            <JumpLink href="#offer" icon={<HandHeart className="h-4 w-4" />}>
              Offer Help
            </JumpLink>
            <JumpLink href="#groups" icon={<HeartHandshake className="h-4 w-4" />}>
              My Groups
            </JumpLink>
            <JumpLink href="#routes" icon={<Inbox className="h-4 w-4" />}>
              Notifications
            </JumpLink>
          </nav>
        </header>

        {notice ? <Notice message={notice} /> : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.82fr)]">
          <div className="flex flex-col gap-6">
            <Section id="request" title="Request Help" eyebrow="Ask only what is needed">
              <form action={requestHelpAction} className="space-y-5">
                <input type="hidden" name="groupId" value={data.group.id} />
                <input type="hidden" name="requesterId" value={data.requester.id} />
                <label className="block">
                  <span className="field-label">What do you need help with?</span>
                  <select name="serviceType" className="field-input" defaultValue="rides">
                    {serviceOptions.map((service) => (
                      <option key={service.value} value={service.value}>
                        {service.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Safe contact note</span>
                  <input
                    name="contact"
                    className="field-input"
                    placeholder="Phone, email, or a safe way to reach you"
                    aria-describedby="contact-help"
                    required
                  />
                  <p id="contact-help" className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    This is kept inside the private request record and is only for coordination after someone accepts.
                  </p>
                </label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="field-label">How soon?</span>
                    <select name="urgency" className="field-input" defaultValue="normal">
                      <option value="low">Whenever someone can</option>
                      <option value="normal">Soon</option>
                      <option value="high">Today if possible</option>
                      <option value="urgent">Time-sensitive</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label inline-flex items-center gap-1">
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                      General area
                    </span>
                    <input name="location" className="field-input" placeholder="Neighborhood or nearby area" />
                  </label>
                  <label className="block">
                    <span className="field-label inline-flex items-center gap-1">
                      <Languages className="h-4 w-4" aria-hidden="true" />
                      Language
                    </span>
                    <input name="language" className="field-input" placeholder="Optional" />
                  </label>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-[var(--subtle)] p-3 text-sm leading-6 text-[var(--soft-text)]">
                  <p className="font-medium text-[var(--text)]">Privacy check</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>Your request is not posted as a public feed.</li>
                    <li>Only the minimum matching details are routed before someone accepts.</li>
                    <li>Support requests expire after 30 days by default.</li>
                  </ul>
                </div>
                <SubmitButton>Ask for help</SubmitButton>
              </form>
            </Section>

            <Section id="offer" title="Offer Help" eyebrow="Set your own boundaries">
              <form action={offerHelpAction} className="space-y-5">
                <input type="hidden" name="accountId" value={data.currentContributor.id} />
                <p className="text-sm leading-6 text-[var(--soft-text)]">
                  Offering as <strong className="font-medium text-[var(--text)]">{data.currentContributor.displayName}</strong>. Choose only what feels realistic right now. This is private coordination information, not a promise or public status.
                </p>
                <fieldset>
                  <legend className="field-label">What can you help with?</legend>
                  <p className="text-sm leading-6 text-[var(--muted)]">Pick at least one. Sensitive help may require extra trust before routing.</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {serviceOptions.map((service) => (
                      <label key={service.value} className="flex min-h-11 items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                        <input name="services" type="checkbox" value={service.value} className="h-4 w-4 accent-[#496b5d]" />
                        <span>{service.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="block">
                  <span className="field-label">Availability boundary</span>
                  <select name="availabilityPreference" className="field-input" defaultValue="available">
                    {availabilityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-2">
                  {availabilityOptions.map((option) => (
                    <p key={option.value} className="rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2 text-sm leading-6 text-[var(--soft-text)]">
                      <strong className="font-medium text-[var(--text)]">{option.label}:</strong> {option.description}
                    </p>
                  ))}
                </div>
                <SubmitButton>Save what I can offer</SubmitButton>
              </form>
            </Section>
          </div>

          <aside className="flex flex-col gap-6">
            <Section id="groups" title="My Group" eyebrow="Where this is happening">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">{data.group.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--soft-text)]">{data.group.description}</p>
                </div>
                <div className="grid gap-2">
                  {data.projects.map((project) => (
                    <div key={project.id} className="rounded-md border border-[var(--border)] bg-[var(--subtle)] px-3 py-2">
                      <p className="text-sm font-medium">{project.name}</p>
                      <p className="text-xs text-[var(--muted)]">{project.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Section id="routes" title="Requests You Can Help With" eyebrow="Private matching">
              <form action={routeOpenRequestsAction} className="mb-4">
                <SubmitButton variant="secondary">Check for matching requests</SubmitButton>
              </form>
              <div className="space-y-3">
                {data.routes.length > 0 ? (
                  data.routes.map((route) => <RouteCard key={route.id} route={route} />)
                ) : (
                  <EmptyState text="No matching requests yet. When one appears, it will show only what you need to decide." />
                )}
              </div>
            </Section>

            <Section id="summary" title="Help Given" eyebrow="Private people, shared memory">
              <div className="space-y-3">
                {data.contributionSummary.length > 0 ? (
                  data.contributionSummary.map((item) => (
                    <div key={item.type} className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                      <span className="text-sm font-medium capitalize">{item.type}</span>
                      <span className="text-sm text-[var(--soft-text)]">{item.count} logged</span>
                    </div>
                  ))
                ) : (
                  <EmptyState text="When help is finished, it can be remembered here without naming who received it." />
                )}
              </div>
            </Section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
      <p className="text-sm font-medium text-[var(--muted)]">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-normal">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function JumpLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--subtle)] px-3 py-2 text-sm font-medium text-[var(--text)] transition hover:border-[var(--muted)] hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
    >
      {icon}
      {children}
    </a>
  );
}

function SubmitButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const className =
    variant === "primary"
      ? "min-h-11 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-text)] transition hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]"
      : "min-h-11 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--page)]";

  return (
    <button type="submit" className={className}>
      {children}
    </button>
  );
}

function Notice({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-[var(--notice-border)] bg-[var(--notice)] px-4 py-3 text-sm text-[var(--notice-text)]" role="status">
      {message}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--subtle)] p-4 text-sm leading-6 text-[var(--muted)]">{text}</p>;
}

function RouteCard({ route }: { route: ExperienceRoute }) {
  const accepted = route.status === "accepted";
  const declined = route.status === "declined";

  return (
    <article className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold capitalize">{route.serviceType} requested</h3>
          <p className="mt-1 text-sm text-[var(--soft-text)]">
            Shared with {route.contributor.displayName}. {route.urgencyLabel}
          </p>
        </div>
        <StatusLabel status={route.status} />
      </div>
      <div className="mt-3 grid gap-2 text-sm text-[var(--soft-text)]">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4" aria-hidden="true" />
          <span>Personal details stay private unless help is accepted.</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" aria-hidden="true" />
          <span>Created {route.createdAtLabel}</span>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {!accepted && !declined ? (
          <>
            <form action={decideRouteAction}>
              <input type="hidden" name="routeId" value={route.id} />
              <input type="hidden" name="contributorAccountId" value={route.contributorAccountId} />
              <input type="hidden" name="decision" value="accepted" />
              <SubmitButton variant="secondary">
                <span className="inline-flex items-center gap-2">
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Accept
                </span>
              </SubmitButton>
            </form>
            <form action={decideRouteAction}>
              <input type="hidden" name="routeId" value={route.id} />
              <input type="hidden" name="contributorAccountId" value={route.contributorAccountId} />
              <input type="hidden" name="decision" value="declined" />
              <SubmitButton variant="secondary">
                <span className="inline-flex items-center gap-2">
                  <X className="h-4 w-4" aria-hidden="true" />
                  Decline
                </span>
              </SubmitButton>
            </form>
          </>
        ) : null}
        {accepted ? (
          <form action={recordContributionAction}>
            <input type="hidden" name="routeId" value={route.id} />
            <SubmitButton>
              <span className="inline-flex items-center gap-2">
                <HeartHandshake className="h-4 w-4" aria-hidden="true" />
                Mark as helped
              </span>
            </SubmitButton>
          </form>
        ) : null}
      </div>
      {accepted ? <p className="mt-3 text-sm leading-6 text-[var(--accent)]">Accepted. Coordinate privately, then mark help given when finished.</p> : null}
      {declined ? <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Declined. That is okay; no contribution or judgment is recorded.</p> : null}
    </article>
  );
}

function StatusLabel({ status }: { status: string }) {
  const label = status.replace("_", " ");

  return <span className="rounded-md border border-[var(--border)] bg-[var(--subtle)] px-2 py-1 text-xs font-medium capitalize text-[var(--soft-text)]">{label}</span>;
}

async function requestHelpAction(formData: FormData) {
  "use server";

  const serviceType = requiredString(formData, "serviceType");
  const contact = requiredString(formData, "contact");
  const location = optionalString(formData, "location");
  const language = optionalString(formData, "language");
  const urgency = requiredString(formData, "urgency") as "low" | "normal" | "high" | "urgent";
  const groupId = requiredString(formData, "groupId");
  const requesterId = requiredString(formData, "requesterId");
  const trustRequirement = sensitiveServices.has(serviceType) ? "elevated" : "lightweight";
  const prisma = createPrismaClient();

  try {
    const project = await findProjectForService(prisma, groupId, serviceType);
    const request = await createSupportRequest(prisma, {
      submittedByAccountId: requesterId,
      groupId,
      projectId: project?.id ?? null,
      requestType: serviceType,
      requestedServices: [{ serviceType, trustRequirement }],
      description: buildRequestDescription({ contact, location, language }),
      urgency,
      privacyLevel: "private",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await routeSupportRequest(prisma, { supportRequestId: request.id });
  } finally {
    await prisma.$disconnect();
  }

  revalidatePath("/");
}

async function offerHelpAction(formData: FormData) {
  "use server";

  const accountId = requiredString(formData, "accountId");
  const services = formData.getAll("services").map(String).filter(Boolean);

  if (services.length === 0) {
    redirect("/?notice=Choose%20at%20least%20one%20kind%20of%20help%20before%20saving%20an%20offer.");
  }
  const availabilityPreference = requiredString(formData, "availabilityPreference") as "unavailable" | "available" | "limited" | "time-sensitive-capable";
  const availableNow = availabilityPreference !== "unavailable";
  const prisma = createPrismaClient();

  try {
    for (const serviceType of services) {
      await declareServiceCapability(prisma, {
        accountId,
        serviceType,
        trustRequirement: sensitiveServices.has(serviceType) ? "elevated" : "lightweight",
        availability: { availableNow, preference: availabilityPreference },
        visibility: "group",
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  revalidatePath("/");
}

async function routeOpenRequestsAction() {
  "use server";

  const prisma = createPrismaClient();

  try {
    const requests = await prisma.supportRequest.findMany({ where: { status: "open" }, select: { id: true } });

    for (const request of requests) {
      await routeSupportRequest(prisma, { supportRequestId: request.id });
    }
  } finally {
    await prisma.$disconnect();
  }

  revalidatePath("/");
}

async function decideRouteAction(formData: FormData) {
  "use server";

  const routeId = requiredString(formData, "routeId");
  const contributorAccountId = requiredString(formData, "contributorAccountId");
  const decision = requiredString(formData, "decision") as "accepted" | "declined";
  const prisma = createPrismaClient();

  try {
    await decideRequestRoute(prisma, { routeId, contributorAccountId, decision });
  } finally {
    await prisma.$disconnect();
  }

  revalidatePath("/");
}

async function recordContributionAction(formData: FormData) {
  "use server";

  const routeId = requiredString(formData, "routeId");
  const prisma = createPrismaClient();

  try {
    const existing = await prisma.contribution.findFirst({
      where: {
        privacyEnvelope: {
          path: ["requestRouteId"],
          equals: routeId,
        },
      },
    });

    if (!existing) {
      await createContributionFromAcceptedRoute(prisma, { routeId });
    }
  } finally {
    await prisma.$disconnect();
  }

  revalidatePath("/");
}

async function getExperienceData() {
  const prisma = createPrismaClient();

  try {
    const { node, group, requester, currentContributor } = await ensureDemoCommons(prisma);
    const [projects, routes, contributions] = await Promise.all([
      prisma.project.findMany({ where: { groupId: group.id, status: "active" }, orderBy: { createdAt: "asc" } }),
      prisma.requestRoute.findMany({
        where: { supportRequest: { groupId: group.id } },
        include: { contributor: true, supportRequest: true },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
      prisma.contribution.findMany({
        where: { groupId: group.id, visibility: "group" },
        orderBy: { occurredAt: "desc" },
        take: 20,
      }),
    ]);

    return {
      node,
      group,
      requester,
      currentContributor,
      projects,
      routes: routes.map((route) => ({
        id: route.id,
        contributorAccountId: route.contributorAccountId,
        contributor: { displayName: route.contributor.displayName },
        serviceType: route.serviceType,
        status: route.status,
        urgencyLabel: urgencyLabel(route.supportRequest.urgency),
        createdAtLabel: formatRelativeDate(route.createdAt),
      })),
      contributionSummary: summarizeContributions(contributions),
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureDemoCommons(prisma: ReturnType<typeof createPrismaClient>) {
  const node = await prisma.node.upsert({
    where: { domain: "localhost" },
    update: {},
    create: {
      id: "node_northside_commons",
      name: "Northside Commons",
      domain: "localhost",
      federationPolicy: "disabled",
      pluginPolicy: "disabled",
      constitutionalPreferences: { supportRequestRetentionDays: 30, pluginsCannotExposeRecipientIdentities: true },
    },
  });

  const group = await prisma.group.upsert({
    where: { nodeId_name: { nodeId: node.id, name: "Gotham Mutual Aid" } },
    update: {},
    create: {
      id: "group_gotham_mutual_aid",
      nodeId: node.id,
      name: "Gotham Mutual Aid",
      description: "A local mutual aid collective coordinating practical support.",
      membershipPolicy: "open",
      privacyPreferences: { supportRequests: "private", contributionVisibility: "group" },
    },
  });

  await ensureProject(prisma, group.id, "Rides", "Appointment, grocery, and community transport coordination.");
  await ensureProject(prisma, group.id, "Food Distribution", "Shared food pickup, packing, and delivery support.");
  await ensureProject(prisma, group.id, "Translation Support", "Language access for forms, calls, appointments, and meetings.");

  const requester = await ensureAccount(prisma, node.id, "acct_mary", "Mary", "participant", "private");
  const currentContributor = await ensureAccount(prisma, node.id, "acct_alice", "Alice", "member", "group");

  await declareServiceCapability(prisma, {
    accountId: currentContributor.id,
    serviceType: "rides",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
    visibility: "group",
  });
  await declareServiceCapability(prisma, {
    accountId: currentContributor.id,
    serviceType: "food delivery",
    trustRequirement: "lightweight",
    availability: { availableNow: true },
    visibility: "group",
  });

  return { node, group, requester, currentContributor };
}

async function ensureProject(prisma: ReturnType<typeof createPrismaClient>, groupId: string, name: string, description: string) {
  return prisma.project.upsert({
    where: { groupId_name: { groupId, name } },
    update: { description, status: "active" },
    create: { groupId, name, description, status: "active" },
  });
}

async function ensureAccount(
  prisma: ReturnType<typeof createPrismaClient>,
  homeNodeId: string,
  id: string,
  displayName: string,
  accountType: "guest" | "participant" | "member",
  profileVisibility: "private" | "group",
) {
  return prisma.account.upsert({
    where: { id },
    update: { displayName, accountType, profileVisibility },
    create: { id, homeNodeId, displayName, accountType, profileVisibility },
  });
}

async function findProjectForService(prisma: ReturnType<typeof createPrismaClient>, groupId: string, serviceType: string) {
  const projectName = serviceType.includes("ride")
    ? "Rides"
    : serviceType.includes("food")
      ? "Food Distribution"
      : serviceType.includes("translation")
        ? "Translation Support"
        : null;

  if (!projectName) {
    return null;
  }

  return prisma.project.findUnique({ where: { groupId_name: { groupId, name: projectName } } });
}

function buildRequestDescription(input: { contact: string; location?: string; language?: string }) {
  return [
    `Private contact note: ${input.contact}`,
    input.location ? `Rough location: ${input.location}` : null,
    input.language ? `Language preference: ${input.language}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeContributions(contributions: Array<{ contributionType: string }>) {
  const counts = new Map<string, number>();

  for (const contribution of contributions) {
    counts.set(contribution.contributionType, (counts.get(contribution.contributionType) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
}

function requiredString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function optionalString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function urgencyLabel(urgency: string) {
  if (urgency === "urgent") {
    return "Time-sensitive, but not broadcast publicly.";
  }

  if (urgency === "high") {
    return "Today if possible.";
  }

  return "Shared without pressure.";
}

function formatRelativeDate(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

type ExperienceRoute = {
  id: string;
  contributorAccountId: string;
  contributor: { displayName: string };
  serviceType: string;
  status: string;
  urgencyLabel: string;
  createdAtLabel: string;
};
