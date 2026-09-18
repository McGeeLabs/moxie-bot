CREATE TABLE "ValheimServerConfig" (
    "guildId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "gamePort" INTEGER NOT NULL,
    "queryPort" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ValheimServerConfig_pkey" PRIMARY KEY ("guildId")
);
ALTER TABLE "ValheimServerConfig" ADD CONSTRAINT "ValheimServerConfig_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
