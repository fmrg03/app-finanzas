-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "InvitationKind" AS ENUM ('INVITE', 'RESET');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SHARED_WITH_ME';
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_JOINED';

-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "linkedDebtId" TEXT;

-- AlterTable
ALTER TABLE "DebtPayment" ADD COLUMN     "mirrorOfId" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "linkedUserId" TEXT;

-- AlterTable
ALTER TABLE "SharedExpense" ADD COLUMN     "mirrorOfId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'MEMBER';

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "kind" "InvitationKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Debt_linkedDebtId_key" ON "Debt"("linkedDebtId");

-- CreateIndex
CREATE UNIQUE INDEX "DebtPayment_mirrorOfId_key" ON "DebtPayment"("mirrorOfId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_linkedUserId_key" ON "Person"("userId", "linkedUserId");

-- CreateIndex
CREATE INDEX "SharedExpense_mirrorOfId_idx" ON "SharedExpense"("mirrorOfId");

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_linkedDebtId_fkey" FOREIGN KEY ("linkedDebtId") REFERENCES "Debt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_mirrorOfId_fkey" FOREIGN KEY ("mirrorOfId") REFERENCES "DebtPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedExpense" ADD CONSTRAINT "SharedExpense_mirrorOfId_fkey" FOREIGN KEY ("mirrorOfId") REFERENCES "SharedExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- El primer usuario que se registró administra la familia
UPDATE "User" SET "role" = 'ADMIN' WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1);
