CREATE TABLE "FeedbackReport" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "accountId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "expected" TEXT,
    "path" TEXT,
    "userAgent" TEXT,
    "appVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "githubIssueUrl" TEXT,
    "hostNotes" TEXT,
    "redactedTitle" TEXT,
    "redactedBody" TEXT,
    "redactedExpected" TEXT,
    "redactedPath" TEXT,
    "redactedUserAgent" TEXT,
    "redactedAppVersion" TEXT,
    "anonymousFingerprintHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FeedbackReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeedbackReport_nodeId_status_createdAt_idx"
ON "FeedbackReport"("nodeId", "status", "createdAt");

CREATE INDEX "FeedbackReport_nodeId_anonymousFingerprintHash_createdAt_idx"
ON "FeedbackReport"("nodeId", "anonymousFingerprintHash", "createdAt");

CREATE INDEX "FeedbackReport_accountId_idx" ON "FeedbackReport"("accountId");

ALTER TABLE "FeedbackReport"
ADD CONSTRAINT "FeedbackReport_nodeId_fkey"
FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedbackReport"
ADD CONSTRAINT "FeedbackReport_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
