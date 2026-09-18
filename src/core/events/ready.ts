import type { Client } from "discord.js";
import { logger } from "../logger";
import { guildConfiguration, type GuildConfiguration } from "../database/guildConfiguration";

export const name = "clientReady";
export const once = true;

export async function execute(client: Client, configuration: GuildConfiguration = guildConfiguration) {
  logger.info("Moxie connected to Discord", { user: client.user?.tag ?? "unknown", guildCount: client.guilds.cache.size });
  let synced = 0;
  let failed = 0;
  for (const guildId of client.guilds.cache.keys()) {
    try {
      await configuration.ensureGuild(guildId);
      synced++;
    } catch {
      failed++;
    }
  }
  logger.info("Guild configuration sync finished", { synced, failed });
}
