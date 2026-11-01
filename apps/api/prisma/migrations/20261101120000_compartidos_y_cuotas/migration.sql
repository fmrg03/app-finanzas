-- CreateEnum
CREATE TYPE "SplitMode" AS ENUM ('EQUAL', 'PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "InstallmentFrequency" AS ENUM ('DAYS_14', 'DAYS_15', 'MONTHLY');

-- AlterEnum
ALTER TYPE "TransactionSource" ADD VALUE 'INSTALLMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'INSTALLMENT_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'INSTALLMENT_OVERDUE';

-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "personId" TEXT,
ADD COLUMN     "sharedId" TEXT;

-- AlterTable
ALTER TABLE "DebtPayment" ADD COLUMN     "accountAmount" DECIMAL(18,2),
ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "installmentPlanId" TEXT,
ADD COLUMN     "myAmountUsd" DECIMAL(18,2),
ADD COLUMN     "myAmountVes" DECIMAL(18,2),
ADD COLUMN     "sharePct" DECIMAL(9,6),
ADD COLUMN     "sharedId" TEXT,
ALTER COLUMN "accountId" DROP NOT NULL;

-- Los movimientos existentes cuentan completos
UPDATE "Transaction" SET "myAmountUsd" = "amountUsd", "myAmountVes" = "amountVes";
ALTER TABLE "Transaction" ALTER COLUMN "myAmountUsd" SET NOT NULL,
ALTER COLUMN "myAmountVes" SET NOT NULL;

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedExpense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paidByPersonId" TEXT,
    "splitMode" "SplitMode" NOT NULL,
    "totalUsd" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedParticipant" (
    "id" TEXT NOT NULL,
    "sharedId" TEXT NOT NULL,
    "personId" TEXT,
    "pct" DECIMAL(9,6) NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "SharedParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "store" TEXT,
    "description" TEXT NOT NULL,
    "categoryId" TEXT,
    "purchaseDate" DATE NOT NULL,
    "totalUsd" DECIMAL(18,2) NOT NULL,
    "downPaymentUsd" DECIMAL(18,2) NOT NULL,
    "count" INTEGER NOT NULL,
    "frequency" "InstallmentFrequency" NOT NULL,
    "accountId" TEXT,
    "rateSource" "RateSource" NOT NULL,
    "rateUsed" DECIMAL(18,6) NOT NULL,
    "sharedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "transactionId" TEXT,

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_name_key" ON "Person"("userId", "name");

-- CreateIndex
CREATE INDEX "SharedExpense_userId_idx" ON "SharedExpense"("userId");

-- CreateIndex
CREATE INDEX "SharedParticipant_sharedId_idx" ON "SharedParticipant"("sharedId");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_sharedId_key" ON "InstallmentPlan"("sharedId");

-- CreateIndex
CREATE INDEX "InstallmentPlan_userId_idx" ON "InstallmentPlan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_transactionId_key" ON "Installment"("transactionId");

-- CreateIndex
CREATE INDEX "Installment_dueDate_idx" ON "Installment"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_planId_n_key" ON "Installment"("planId", "n");

-- CreateIndex
CREATE INDEX "Debt_personId_idx" ON "Debt"("personId");

-- CreateIndex
CREATE INDEX "Debt_sharedId_idx" ON "Debt"("sharedId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_sharedId_key" ON "Transaction"("sharedId");

-- CreateIndex
CREATE INDEX "Transaction_installmentPlanId_idx" ON "Transaction"("installmentPlanId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sharedId_fkey" FOREIGN KEY ("sharedId") REFERENCES "SharedExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_installmentPlanId_fkey" FOREIGN KEY ("installmentPlanId") REFERENCES "InstallmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_sharedId_fkey" FOREIGN KEY ("sharedId") REFERENCES "SharedExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedExpense" ADD CONSTRAINT "SharedExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedExpense" ADD CONSTRAINT "SharedExpense_paidByPersonId_fkey" FOREIGN KEY ("paidByPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedParticipant" ADD CONSTRAINT "SharedParticipant_sharedId_fkey" FOREIGN KEY ("sharedId") REFERENCES "SharedExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedParticipant" ADD CONSTRAINT "SharedParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_sharedId_fkey" FOREIGN KEY ("sharedId") REFERENCES "SharedExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InstallmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Personas a partir de las deudas que ya existen, y cada deuda enlazada a la suya
INSERT INTO "Person" ("id", "userId", "name", "updatedAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || n."name"), 1, 24), n."userId", n."name", CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "userId", trim("person") AS "name" FROM "Debt" WHERE trim("person") <> '') n;

UPDATE "Debt" d SET "personId" = p."id" FROM "Person" p WHERE p."userId" = d."userId" AND p."name" = trim(d."person");
