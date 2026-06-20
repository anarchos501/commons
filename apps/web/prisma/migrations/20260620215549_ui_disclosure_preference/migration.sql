-- CreateTable
CREATE TABLE "UiDisclosurePreference" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "revealAll" BOOLEAN NOT NULL DEFAULT false,
    "overrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UiDisclosurePreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UiDisclosurePreference_accountId_key" ON "UiDisclosurePreference"("accountId");

-- AddForeignKey
ALTER TABLE "UiDisclosurePreference" ADD CONSTRAINT "UiDisclosurePreference_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
