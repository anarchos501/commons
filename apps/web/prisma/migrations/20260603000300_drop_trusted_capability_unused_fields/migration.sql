-- Remove unused fields from TrustedServiceCapability.
-- These fields were never read or written in application code.
ALTER TABLE "TrustedServiceCapability" DROP COLUMN "supportThreshold";
ALTER TABLE "TrustedServiceCapability" DROP COLUMN "reviewEndsAt";
