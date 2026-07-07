-- AlterEnum
ALTER TYPE "SignedEventType" ADD VALUE 'mediated_action_requested';

-- AlterTable
ALTER TABLE "LinkedNodePresence" ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "homeNodeDomain" TEXT;

-- CreateTable
CREATE TABLE "IdentityKeyCustody" (
    "id" TEXT NOT NULL,
    "portableIdentityId" TEXT NOT NULL,
    "signingPrivateKeyPem" TEXT NOT NULL,
    "encryptionPublicKey" TEXT,
    "encryptionPrivateKeyPem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "IdentityKeyCustody_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdentityKeyCustody_portableIdentityId_key" ON "IdentityKeyCustody"("portableIdentityId");

-- AddForeignKey
ALTER TABLE "IdentityKeyCustody" ADD CONSTRAINT "IdentityKeyCustody_portableIdentityId_fkey" FOREIGN KEY ("portableIdentityId") REFERENCES "PortableIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
