-- CreateEnum
CREATE TYPE "CoordinationSpaceType" AS ENUM ('group', 'project', 'responsibility');

-- CreateTable
CREATE TABLE "Bulletin" (
    "id" TEXT NOT NULL,
    "spaceType" "CoordinationSpaceType" NOT NULL,
    "spaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bulletin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "spaceType" "CoordinationSpaceType" NOT NULL,
    "spaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationEntry" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "PublicationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivingDocument" (
    "id" TEXT NOT NULL,
    "spaceType" "CoordinationSpaceType" NOT NULL,
    "spaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currentBody" TEXT NOT NULL,
    "lastRevisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivingDocumentRevision" (
    "id" TEXT NOT NULL,
    "livingDocumentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivingDocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bulletin_spaceType_spaceId_idx" ON "Bulletin"("spaceType", "spaceId");

-- CreateIndex
CREATE INDEX "Bulletin_authorId_idx" ON "Bulletin"("authorId");

-- CreateIndex
CREATE INDEX "Bulletin_archivedAt_idx" ON "Bulletin"("archivedAt");

-- CreateIndex
CREATE INDEX "Publication_spaceType_spaceId_idx" ON "Publication"("spaceType", "spaceId");

-- CreateIndex
CREATE INDEX "Publication_createdByAccountId_idx" ON "Publication"("createdByAccountId");

-- CreateIndex
CREATE INDEX "Publication_archivedAt_idx" ON "Publication"("archivedAt");

-- CreateIndex
CREATE INDEX "PublicationEntry_publicationId_idx" ON "PublicationEntry"("publicationId");

-- CreateIndex
CREATE INDEX "PublicationEntry_authorId_idx" ON "PublicationEntry"("authorId");

-- CreateIndex
CREATE INDEX "PublicationEntry_archivedAt_idx" ON "PublicationEntry"("archivedAt");

-- CreateIndex
CREATE INDEX "LivingDocument_spaceType_spaceId_idx" ON "LivingDocument"("spaceType", "spaceId");

-- CreateIndex
CREATE INDEX "LivingDocument_archivedAt_idx" ON "LivingDocument"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LivingDocument_spaceType_spaceId_title_key" ON "LivingDocument"("spaceType", "spaceId", "title");

-- CreateIndex
CREATE INDEX "LivingDocumentRevision_livingDocumentId_idx" ON "LivingDocumentRevision"("livingDocumentId");

-- CreateIndex
CREATE INDEX "LivingDocumentRevision_authorId_idx" ON "LivingDocumentRevision"("authorId");

-- AddForeignKey
ALTER TABLE "Bulletin" ADD CONSTRAINT "Bulletin_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationEntry" ADD CONSTRAINT "PublicationEntry_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationEntry" ADD CONSTRAINT "PublicationEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivingDocumentRevision" ADD CONSTRAINT "LivingDocumentRevision_livingDocumentId_fkey" FOREIGN KEY ("livingDocumentId") REFERENCES "LivingDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivingDocumentRevision" ADD CONSTRAINT "LivingDocumentRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
