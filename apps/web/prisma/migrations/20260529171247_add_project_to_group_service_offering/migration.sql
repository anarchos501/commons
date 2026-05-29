-- AlterTable
ALTER TABLE "GroupServiceOffering" ADD COLUMN     "projectId" TEXT;

-- CreateIndex
CREATE INDEX "GroupServiceOffering_projectId_idx" ON "GroupServiceOffering"("projectId");

-- AddForeignKey
ALTER TABLE "GroupServiceOffering" ADD CONSTRAINT "GroupServiceOffering_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
