-- Design Gate D4: Discussion schema
-- Discussion is temporary coordination, not archival content.

CREATE TABLE "DiscussionThread" (
    "id" TEXT NOT NULL,
    "spaceType" "CoordinationSpaceType" NOT NULL,
    "spaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "closedByPetitionId" TEXT,
    "closureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscussionThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscussionMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiscussionThread_spaceType_spaceId_idx" ON "DiscussionThread"("spaceType", "spaceId");
CREATE INDEX "DiscussionThread_createdByAccountId_idx" ON "DiscussionThread"("createdByAccountId");
CREATE INDEX "DiscussionThread_lastActivityAt_idx" ON "DiscussionThread"("lastActivityAt");
CREATE INDEX "DiscussionThread_closedAt_idx" ON "DiscussionThread"("closedAt");
CREATE INDEX "DiscussionMessage_threadId_idx" ON "DiscussionMessage"("threadId");
CREATE INDEX "DiscussionMessage_authorId_idx" ON "DiscussionMessage"("authorId");
CREATE INDEX "DiscussionMessage_expiresAt_idx" ON "DiscussionMessage"("expiresAt");
CREATE INDEX "DiscussionMessage_createdAt_idx" ON "DiscussionMessage"("createdAt");

ALTER TABLE "DiscussionThread" ADD CONSTRAINT "DiscussionThread_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
