CREATE TABLE "ModerationConfig" (
  "guildId" TEXT NOT NULL,
  "logChannelId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModerationConfig_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "ModerationWarning" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "moderatorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationWarning_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModerationWarning_guildId_targetUserId_createdAt_idx"
  ON "ModerationWarning"("guildId", "targetUserId", "createdAt");

ALTER TABLE "ModerationConfig" ADD CONSTRAINT "ModerationConfig_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModerationWarning" ADD CONSTRAINT "ModerationWarning_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
