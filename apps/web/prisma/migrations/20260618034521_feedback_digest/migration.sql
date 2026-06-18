-- AlterTable
ALTER TABLE "FeedbackReport" ADD COLUMN     "digestId" TEXT;

-- CreateTable
CREATE TABLE "FeedbackDigest" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reportCount" INTEGER NOT NULL,
    "compiledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackDigest_nodeId_compiledAt_idx" ON "FeedbackDigest"("nodeId", "compiledAt");

-- CreateIndex
CREATE INDEX "FeedbackReport_digestId_idx" ON "FeedbackReport"("digestId");

-- AddForeignKey
ALTER TABLE "FeedbackReport" ADD CONSTRAINT "FeedbackReport_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "FeedbackDigest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackDigest" ADD CONSTRAINT "FeedbackDigest_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
