CREATE TYPE "ValheimMonitorStatus" AS ENUM ('online', 'unavailable');
ALTER TABLE "ValheimServerConfig"
  ADD COLUMN "monitorStatus" "ValheimMonitorStatus",
  ADD COLUMN "lastNotifiedStatus" "ValheimMonitorStatus",
  ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastCheckedAt" TIMESTAMP(3);
