-- CreateEnum
CREATE TYPE "ReserveKind" AS ENUM ('SET_ASIDE', 'USED');

-- AlterEnum
ALTER TYPE "RecurrenceFrequency" ADD VALUE 'QUARTERLY';
ALTER TYPE "RecurrenceFrequency" ADD VALUE 'SEMIANNUAL';
ALTER TYPE "RecurrenceFrequency" ADD VALUE 'ANNUAL';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RESERVE_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'RESERVE_SHORT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "Recurring" ADD COLUMN     "reserve" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reserveDay" INTEGER,
ADD COLUMN     "reserveNextDate" DATE;

-- CreateTable
CREATE TABLE "RecurringReserve" (
    "id" TEXT NOT NULL,
    "recurringId" TEXT NOT NULL,
    "kind" "ReserveKind" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringReserve_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringReserve_recurringId_date_idx" ON "RecurringReserve"("recurringId", "date");

-- AddForeignKey
ALTER TABLE "RecurringReserve" ADD CONSTRAINT "RecurringReserve_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "Recurring"("id") ON DELETE CASCADE ON UPDATE CASCADE;
