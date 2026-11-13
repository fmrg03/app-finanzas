-- Verificación de respaldos
ALTER TYPE "NotificationType" ADD VALUE 'BACKUP_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'BACKUP_STALE';

CREATE TABLE "BackupCheck" (
    "id" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "sizeBytes" BIGINT,
    "users" INTEGER,
    "accounts" INTEGER,
    "transactions" INTEGER,
    "error" TEXT,

    CONSTRAINT "BackupCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupCheck_checkedAt_idx" ON "BackupCheck"("checkedAt");
