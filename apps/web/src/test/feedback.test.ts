import assert from "node:assert/strict";
import test from "node:test";
import { createPrismaClient } from "../lib/prisma";
import {
  exportFeedbackToGithub,
  feedbackFingerprint,
  githubFeedbackConfigured,
  submitFeedback,
  updateFeedbackReview,
} from "../lib/feedback";

const prisma = createPrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("anonymous feedback is stored locally with a hashed fingerprint and safe path", async () => {
  const fixture = await createFixture("feedback_anon");
  try {
    const result = await submitFeedback(prisma, {
      nodeId: fixture.node.id,
      type: "bug",
      title: "Broken button",
      body: "The button did not respond.",
      expected: "The form should submit.",
      path: "/groups/private-group-id?discussionThread=private-thread-id",
      userAgent: "Test Browser",
      appVersion: "test-version",
      ipCandidate: "203.0.113.5",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const report = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: result.reportId } });
    assert.equal(report.accountId, null);
    assert.equal(report.path, "/groups/[groupId]");
    assert.equal(report.anonymousFingerprintHash, feedbackFingerprint({
      nodeId: fixture.node.id,
      ipCandidate: "203.0.113.5",
      userAgent: "Test Browser",
    }));
    assert.equal(JSON.stringify(report).includes("203.0.113.5"), false);
  } finally {
    await cleanup("feedback_anon");
  }
});

test("anonymous feedback is limited to three reports per fingerprint per hour", async () => {
  const fixture = await createFixture("feedback_limit");
  try {
    for (let index = 0; index < 3; index++) {
      const result = await submitFeedback(prisma, {
        nodeId: fixture.node.id,
        type: "ux_confusion",
        title: `Confusing flow ${index}`,
        body: "I could not find the action.",
        userAgent: "Same Browser",
        ipCandidate: "198.51.100.9",
      });
      assert.equal(result.ok, true);
    }
    const blocked = await submitFeedback(prisma, {
      nodeId: fixture.node.id,
      type: "bug",
      title: "Fourth report",
      body: "This should be throttled.",
      userAgent: "Same Browser",
      ipCandidate: "198.51.100.9",
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.reason, "rate_limited");
  } finally {
    await cleanup("feedback_limit");
  }
});

test("anonymous feedback limit holds under concurrent submissions", async () => {
  const fixture = await createFixture("feedback_parallel_limit");
  try {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) => submitFeedback(prisma, {
        nodeId: fixture.node.id,
        type: "bug",
        title: `Parallel report ${index}`,
        body: "Concurrent anonymous submission.",
        userAgent: "Parallel Browser",
        ipCandidate: "203.0.113.44",
      })),
    );
    assert.equal(results.filter((result) => result.ok).length, 3);
    assert.equal(results.filter((result) => !result.ok && result.reason === "rate_limited").length, 1);
  } finally {
    await cleanup("feedback_parallel_limit");
  }
});

test("logged-in feedback stores accountId and bypasses the anonymous cooldown", async () => {
  const fixture = await createFixture("feedback_member");
  try {
    for (let index = 0; index < 5; index++) {
      const result = await submitFeedback(prisma, {
        nodeId: fixture.node.id,
        accountId: fixture.member.id,
        type: "feature_request",
        title: `Feature ${index}`,
        body: "Please add this.",
        userAgent: "Member Browser",
        ipCandidate: "192.0.2.10",
      });
      assert.equal(result.ok, true);
    }
    const reports = await prisma.feedbackReport.findMany({ where: { nodeId: fixture.node.id } });
    assert.equal(reports.length, 5);
    assert.equal(reports.every((report) => report.accountId === fixture.member.id), true);
    assert.equal(reports.every((report) => report.anonymousFingerprintHash === null), true);
  } finally {
    await cleanup("feedback_member");
  }
});

test("only an active host can review feedback and redaction preserves the original", async () => {
  const fixture = await createFixture("feedback_review");
  try {
    const submitted = await submitFeedback(prisma, {
      nodeId: fixture.node.id,
      accountId: fixture.member.id,
      type: "safety_privacy",
      title: "Original title",
      body: "Original private description",
    });
    assert.equal(submitted.ok, true);
    if (!submitted.ok) return;
    await assert.rejects(
      () => updateFeedbackReview(prisma, {
        nodeId: fixture.node.id,
        hostAccountId: fixture.member.id,
        reportId: submitted.reportId,
        status: "reviewed",
      }),
      /node host/,
    );
    await updateFeedbackReview(prisma, {
      nodeId: fixture.node.id,
      hostAccountId: fixture.host.id,
      reportId: submitted.reportId,
      status: "reviewed",
      redactedTitle: "Safe title",
      redactedBody: "Safe description",
      hostNotes: "Reviewed for upstream export.",
    });
    const report = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: submitted.reportId } });
    assert.equal(report.title, "Original title");
    assert.equal(report.body, "Original private description");
    assert.equal(report.redactedTitle, "Safe title");
    assert.equal(report.redactedBody, "Safe description");
    assert.ok(report.reviewedAt);
  } finally {
    await cleanup("feedback_review");
  }
});

test("GitHub export configuration and mocked export update the report", async () => {
  const fixture = await createFixture("feedback_export");
  try {
    assert.equal(githubFeedbackConfigured({}), false);
    const submitted = await submitFeedback(prisma, {
      nodeId: fixture.node.id,
      accountId: fixture.member.id,
      type: "bug",
      title: "Original title",
      body: "Original body",
      expected: "Original expected",
      path: "/groups/private-id",
      userAgent: "Original Browser",
      appVersion: "0.1.0",
    });
    assert.equal(submitted.ok, true);
    if (!submitted.ok) return;
    await updateFeedbackReview(prisma, {
      nodeId: fixture.node.id,
      hostAccountId: fixture.host.id,
      reportId: submitted.reportId,
      status: "reviewed",
      redactedTitle: "Export title",
      redactedBody: "Export body",
      redactedPath: "/groups/redacted",
      redactedUserAgent: "Safe Browser",
      hostNotes: "Confirmed reproducible.",
    });
    let requestBody = "";
    const result = await exportFeedbackToGithub(prisma, {
      nodeId: fixture.node.id,
      hostAccountId: fixture.host.id,
      reportId: submitted.reportId,
      env: { GITHUB_FEEDBACK_REPO: "commons/test", GITHUB_FEEDBACK_TOKEN: "secret" },
      fetchImpl: async (_url, init) => {
        requestBody = String(init?.body);
        return new Response(JSON.stringify({ html_url: "https://github.com/commons/test/issues/42" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.equal(result.issueUrl, "https://github.com/commons/test/issues/42");
    assert.match(requestBody, /Export title/);
    assert.match(requestBody, /Export body/);
    assert.match(requestBody, /Safe Browser/);
    assert.doesNotMatch(requestBody, /Original body/);
    assert.doesNotMatch(requestBody, /private-id/);
    const report = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: submitted.reportId } });
    assert.equal(report.status, "exported_to_github");
    assert.equal(report.githubIssueUrl, result.issueUrl);
  } finally {
    await cleanup("feedback_export");
  }
});

async function createFixture(prefix: string) {
  await cleanup(prefix);
  const node = await prisma.node.create({
    data: { id: `${prefix}_node`, name: `Node ${prefix}`, domain: `${prefix}.localhost` },
  });
  const host = await prisma.account.create({
    data: { id: `${prefix}_host`, homeNodeId: node.id, displayName: "Host", accountType: "member" },
  });
  const member = await prisma.account.create({
    data: { id: `${prefix}_member`, homeNodeId: node.id, displayName: "Member", accountType: "member" },
  });
  await prisma.nodeHost.create({ data: { nodeId: node.id, accountId: host.id } });
  return { node, host, member };
}

async function cleanup(prefix: string) {
  await prisma.feedbackReport.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.nodeHost.deleteMany({ where: { nodeId: { startsWith: prefix } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.node.deleteMany({ where: { id: { startsWith: prefix } } });
}
