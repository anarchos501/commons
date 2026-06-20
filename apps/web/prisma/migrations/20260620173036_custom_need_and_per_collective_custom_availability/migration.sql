-- AlterTable
ALTER TABLE "GroupMembership" ADD COLUMN     "customAvailability" JSONB,
ADD COLUMN     "customAvailable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SupportRequest" ADD COLUMN     "customNeed" TEXT;
