-- AlterTable
ALTER TABLE "InstallmentPlan" ADD COLUMN     "myAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_myAccountId_fkey" FOREIGN KEY ("myAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
