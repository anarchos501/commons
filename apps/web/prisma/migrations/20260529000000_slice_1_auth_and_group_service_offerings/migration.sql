-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "email" TEXT,
ADD COLUMN     "passwordHash" TEXT;

-- AlterTable
ALTER TABLE "SupportRequest" ADD COLUMN     "guestRequestId" TEXT;

-- CreateTable
CREATE TABLE "GroupServiceOffering" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "minimumContributorTrust" TEXT NOT NULL DEFAULT 'lightweight',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupServiceOffering_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupServiceOffering_groupId_idx" ON "GroupServiceOffering"("groupId");

-- CreateIndex
CREATE INDEX "GroupServiceOffering_status_idx" ON "GroupServiceOffering"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GroupServiceOffering_groupId_serviceType_key" ON "GroupServiceOffering"("groupId", "serviceType");

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

-- AddForeignKey
ALTER TABLE "GroupServiceOffering" ADD CONSTRAINT "GroupServiceOffering_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
