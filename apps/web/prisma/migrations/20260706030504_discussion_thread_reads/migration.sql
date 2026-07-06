-- CreateTable
CREATE TABLE "DiscussionThreadRead" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionThreadRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscussionThreadRead_threadId_idx" ON "DiscussionThreadRead"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscussionThreadRead_accountId_threadId_key" ON "DiscussionThreadRead"("accountId", "threadId");

-- AddForeignKey
ALTER TABLE "DiscussionThreadRead" ADD CONSTRAINT "DiscussionThreadRead_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionThreadRead" ADD CONSTRAINT "DiscussionThreadRead_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
