-- AlterTable
ALTER TABLE "SharedRequest" ADD COLUMN     "targetSharedId" TEXT;

-- AddForeignKey
ALTER TABLE "SharedRequest" ADD CONSTRAINT "SharedRequest_targetSharedId_fkey" FOREIGN KEY ("targetSharedId") REFERENCES "SharedExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
