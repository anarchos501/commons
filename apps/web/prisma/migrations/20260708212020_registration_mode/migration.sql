-- CreateEnum
CREATE TYPE "RegistrationMode" AS ENUM ('open', 'invite_only');

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "registrationMode" "RegistrationMode" NOT NULL DEFAULT 'open';
