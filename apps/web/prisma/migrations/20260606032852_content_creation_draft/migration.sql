-- CreateEnum
CREATE TYPE "ContentCreationType" AS ENUM ('bulletin', 'publication', 'publication_entry', 'living_document');

-- CreateTable
CREATE TABLE "ContentCreationDraft" (
    "id" TEXT NOT NULL,
    "contentType" "ContentCreationType" NOT NULL,
    "groupId" TEXT NOT NULL,
    "spaceType" "CoordinationSpaceType" NOT NULL,
    "spaceId" TEXT NOT NULL,
    "publicationId" TEXT,
    "authorAccountId" TEXT NOT NULL,
    "createdByMembershipId" TEXT,
    "createdByProjectMembershipId" TEXT,
    "title" TEXT,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "createdContentId" TEXT,

    CONSTRAINT "ContentCreationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentCreationDraft_groupId_idx" ON "ContentCreationDraft"("groupId");

-- CreateIndex
CREATE INDEX "ContentCreationDraft_appliedAt_idx" ON "ContentCreationDraft"("appliedAt");

-- AddForeignKey
ALTER TABLE "ContentCreationDraft" ADD CONSTRAINT "ContentCreationDraft_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "ContentCreationDraft"
  ADD CONSTRAINT "content_creation_draft_one_proposer"
  CHECK (
    ("createdByMembershipId" IS NOT NULL AND "createdByProjectMembershipId" IS NULL) OR
    ("createdByMembershipId" IS NULL     AND "createdByProjectMembershipId" IS NOT NULL)
  );
