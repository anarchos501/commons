import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";
import { requireActiveNodeHost } from "./node-governance";

export const FEEDBACK_TYPES = ["bug", "ux_confusion", "feature_request", "safety_privacy"] as const;
export const FEEDBACK_STATUSES = ["new", "reviewed", "dismissed", "resolved_locally", "exported_to_github"] as const;
export const ANONYMOUS_FEEDBACK_LIMIT = 3;
export const ANONYMOUS_FEEDBACK_WINDOW_MS = 60 * 60 * 1000;

type FeedbackType = (typeof FEEDBACK_TYPES)[number];
type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type SubmitFeedbackResult =
  | { ok: true; reportId: string }
  | { ok: false; reason: "invalid" | "rate_limited"; retryAfter?: Date };

export function feedbackFingerprint(input: {
  nodeId: string;
  ipCandidate: string;
  userAgent: string;
  secret?: string;
}): string {
  const secret = input.secret ?? process.env.FEEDBACK_FINGERPRINT_SECRET ?? process.env.SESSION_SECRET ?? "commons-feedback-dev";
  return createHash("sha256")
    .update(`${input.nodeId}\n${input.ipCandidate}\n${input.userAgent}\n${secret}`)
    .digest("hex");
}

export function clientIpCandidate(headerValues: {
  forwardedFor?: string | null;
  realIp?: string | null;
}): string {
  return headerValues.forwardedFor?.split(",")[0]?.trim() || headerValues.realIp?.trim() || "unknown";
}

export async function submitFeedback(
  prisma: PrismaClient,
  input: {
    nodeId: string;
    accountId?: string | null;
    type: string;
    title: string;
    body: string;
    expected?: string | null;
    path?: string | null;
    userAgent?: string | null;
    appVersion?: string | null;
    ipCandidate?: string;
    now?: Date;
  },
): Promise<SubmitFeedbackResult> {
  const type = input.type.trim() as FeedbackType;
  const title = input.title.trim();
  const body = input.body.trim();
  const expected = cleanOptional(input.expected, 4000);
  const path = safeFeedbackPath(input.path);
  const userAgent = cleanOptional(input.userAgent, 1000);
  const appVersion = cleanOptional(input.appVersion, 200);
  if (!FEEDBACK_TYPES.includes(type) || !title || title.length > 200 || !body || body.length > 10000) {
    return { ok: false, reason: "invalid" };
  }

  const now = input.now ?? new Date();
  let anonymousFingerprintHash: string | null = null;
  if (!input.accountId) {
    anonymousFingerprintHash = feedbackFingerprint({
      nodeId: input.nodeId,
      ipCandidate: input.ipCandidate ?? "unknown",
      userAgent: userAgent ?? "",
    });
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`feedback:${input.nodeId}:${anonymousFingerprintHash}`}, 0))`;
      const windowStart = new Date(now.getTime() - ANONYMOUS_FEEDBACK_WINDOW_MS);
      const recentCount = await tx.feedbackReport.count({
        where: {
          nodeId: input.nodeId,
          accountId: null,
          anonymousFingerprintHash,
          createdAt: { gte: windowStart },
        },
      });
      if (recentCount >= ANONYMOUS_FEEDBACK_LIMIT) {
        const oldest = await tx.feedbackReport.findFirst({
          where: {
            nodeId: input.nodeId,
            accountId: null,
            anonymousFingerprintHash,
            createdAt: { gte: windowStart },
          },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        });
        return {
          ok: false as const,
          reason: "rate_limited" as const,
          retryAfter: new Date((oldest?.createdAt ?? now).getTime() + ANONYMOUS_FEEDBACK_WINDOW_MS),
        };
      }
      const report = await tx.feedbackReport.create({
        data: {
          nodeId: input.nodeId,
          accountId: null,
          type,
          title,
          body,
          expected,
          path,
          userAgent,
          appVersion,
          anonymousFingerprintHash,
        },
        select: { id: true },
      });
      return { ok: true as const, reportId: report.id };
    });
  }

  const report = await prisma.feedbackReport.create({
    data: {
      nodeId: input.nodeId,
      accountId: input.accountId,
      type,
      title,
      body,
      expected,
      path,
      userAgent,
      appVersion,
      anonymousFingerprintHash: null,
    },
    select: { id: true },
  });
  return { ok: true, reportId: report.id };
}

export async function updateFeedbackReview(
  prisma: PrismaClient,
  input: {
    nodeId: string;
    hostAccountId: string;
    reportId: string;
    status: string;
    hostNotes?: string | null;
    redactedTitle?: string | null;
    redactedBody?: string | null;
    redactedExpected?: string | null;
    redactedPath?: string | null;
    redactedUserAgent?: string | null;
    redactedAppVersion?: string | null;
  },
): Promise<void> {
  await requireActiveNodeHost(prisma, input.nodeId, input.hostAccountId);
  if (!FEEDBACK_STATUSES.includes(input.status as FeedbackStatus) || input.status === "exported_to_github") {
    throw new Error("Invalid feedback status.");
  }
  const now = new Date();
  const report = await prisma.feedbackReport.findFirst({
    where: { id: input.reportId, nodeId: input.nodeId },
    select: { id: true, status: true },
  });
  if (!report) throw new Error("Feedback report not found.");
  if (report.status === "exported_to_github") {
    throw new Error("Exported feedback reports are read-only.");
  }
  await prisma.feedbackReport.update({
    where: { id: report.id },
    data: {
      status: input.status,
      hostNotes: cleanOptional(input.hostNotes, 10000),
      redactedTitle: cleanOptional(input.redactedTitle, 200),
      redactedBody: cleanOptional(input.redactedBody, 10000),
      redactedExpected: cleanOptional(input.redactedExpected, 4000),
      redactedPath: safeFeedbackPath(input.redactedPath),
      redactedUserAgent: cleanOptional(input.redactedUserAgent, 1000),
      redactedAppVersion: cleanOptional(input.redactedAppVersion, 200),
      reviewedAt: now,
      resolvedAt: input.status === "dismissed" || input.status === "resolved_locally" ? now : null,
    },
  });
}

type GithubFeedbackEnv = Record<string, string | undefined>;

export function githubFeedbackConfigured(env: GithubFeedbackEnv = process.env): boolean {
  return Boolean(env.GITHUB_FEEDBACK_REPO?.trim() && env.GITHUB_FEEDBACK_TOKEN?.trim());
}

export async function exportFeedbackToGithub(
  prisma: PrismaClient,
  input: {
    nodeId: string;
    hostAccountId: string;
    reportId: string;
    fetchImpl?: typeof fetch;
    env?: GithubFeedbackEnv;
  },
): Promise<{ issueUrl: string }> {
  await requireActiveNodeHost(prisma, input.nodeId, input.hostAccountId);
  const env = input.env ?? process.env;
  const repo = env.GITHUB_FEEDBACK_REPO?.trim();
  const token = env.GITHUB_FEEDBACK_TOKEN?.trim();
  if (!repo || !token) throw new Error("GitHub feedback export is not configured.");

  const report = await prisma.feedbackReport.findFirst({
    where: { id: input.reportId, nodeId: input.nodeId },
  });
  if (!report) throw new Error("Feedback report not found.");
  const title = report.redactedTitle?.trim() || report.title;
  const issueBody = buildGithubIssueBody(report);
  const response = await (input.fetchImpl ?? fetch)(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body: issueBody }),
  });
  if (!response.ok) throw new Error(`GitHub issue export failed (${response.status}).`);
  const payload = await response.json() as { html_url?: string };
  if (!payload.html_url) throw new Error("GitHub issue export returned no issue URL.");

  const now = new Date();
  await prisma.feedbackReport.update({
    where: { id: report.id },
    data: {
      status: "exported_to_github",
      githubIssueUrl: payload.html_url,
      reviewedAt: report.reviewedAt ?? now,
    },
  });
  return { issueUrl: payload.html_url };
}

function buildGithubIssueBody(report: {
  id: string;
  type: string;
  body: string;
  expected: string | null;
  path: string | null;
  userAgent: string | null;
  appVersion: string | null;
  hostNotes: string | null;
  redactedBody: string | null;
  redactedExpected: string | null;
  redactedPath: string | null;
  redactedUserAgent: string | null;
  redactedAppVersion: string | null;
}): string {
  return [
    `**Report type:** ${report.type.replaceAll("_", " ")}`,
    "",
    "## Description",
    report.redactedBody?.trim() || report.body,
    "",
    "## Expected behavior",
    report.redactedExpected?.trim() || report.expected || "_Not provided._",
    "",
    `**Page path:** ${report.redactedPath?.trim() || report.path || "_Not provided._"}`,
    `**App version:** ${report.redactedAppVersion?.trim() || report.appVersion || "_Not provided._"}`,
    `**Browser:** ${report.redactedUserAgent?.trim() || report.userAgent || "_Not provided._"}`,
    "",
    "## Node host note",
    report.hostNotes?.trim() || "_None._",
    "",
    `Internal feedback report: ${report.id}`,
  ].join("\n");
}

function cleanOptional(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function safeFeedbackPath(value: string | null | undefined): string | null {
  const normalized = cleanOptional(value, 1000);
  if (!normalized?.startsWith("/") || normalized.startsWith("//")) return null;

  const pathname = normalized.split(/[?#]/, 1)[0];
  const segments = pathname.split("/");
  const dynamicSegmentByParent: Record<string, string> = {
    coalitions: "[coalitionId]",
    groups: "[groupId]",
    invite: "[token]",
    projects: "[projectId]",
    request: "[groupId]",
    responsibilities: "[responsibilityId]",
  };

  if (segments.length > 2 && dynamicSegmentByParent[segments[1]]) {
    segments[2] = dynamicSegmentByParent[segments[1]];
  }
  if (segments[1] === "request" && segments[2] === "status" && segments.length > 3) {
    segments[3] = "[token]";
  }

  return segments.join("/").slice(0, 500);
}
