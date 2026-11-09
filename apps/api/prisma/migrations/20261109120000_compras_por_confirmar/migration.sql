-- CreateEnum
CREATE TYPE "SharedRequestKind" AS ENUM ('PURCHASE', 'INSTALLMENTS');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SHARED_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'SHARED_REQUEST_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'SHARED_REQUEST_REJECTED';

-- CreateTable
CREATE TABLE "SharedRequest" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "kind" "SharedRequestKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedRequest_toUserId_idx" ON "SharedRequest"("toUserId");

-- CreateIndex
CREATE INDEX "SharedRequest_fromUserId_idx" ON "SharedRequest"("fromUserId");

-- AddForeignKey
ALTER TABLE "SharedRequest" ADD CONSTRAINT "SharedRequest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedRequest" ADD CONSTRAINT "SharedRequest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
