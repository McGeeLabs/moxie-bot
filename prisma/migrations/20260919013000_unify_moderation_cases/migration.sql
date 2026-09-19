CREATE TYPE "ModerationAction" AS ENUM ('warn', 'timeout', 'untimeout', 'kick', 'ban');

ALTER TABLE "ModerationWarning" RENAME TO "ModerationCase";
ALTER INDEX "ModerationWarning_pkey" RENAME TO "ModerationCase_pkey";
ALTER INDEX "ModerationWarning_guildId_targetUserId_createdAt_idx"
  RENAME TO "ModerationCase_guildId_targetUserId_createdAt_idx";
ALTER TABLE "ModerationCase" RENAME CONSTRAINT "ModerationWarning_guildId_fkey" TO "ModerationCase_guildId_fkey";

ALTER TABLE "ModerationCase"
  ADD COLUMN "action" "ModerationAction" NOT NULL DEFAULT 'warn',
  ADD COLUMN "durationMinutes" INTEGER,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "reasonUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "reasonUpdatedById" TEXT,
  ADD CONSTRAINT "ModerationCase_duration_check" CHECK (
    ("action" = 'timeout' AND "durationMinutes" BETWEEN 1 AND 40320)
    OR ("action" <> 'timeout' AND "durationMinutes" IS NULL)
  );
