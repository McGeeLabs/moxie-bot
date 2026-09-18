import { Client, Collection, Events, GatewayIntentBits } from "discord.js";
import { commands } from "../../modules";
import type { MoxieClient } from "../../types";
import * as ready from "../events/ready";
import * as interactionCreate from "../events/interactionCreate";
import { logger } from "../logger";
import { guildConfiguration } from "../database/guildConfiguration";
import { WebhookService } from "../../integrations/webhooks/service";
import { DiscordWebhookDelivery } from "../../integrations/webhooks/discordDelivery";
import { ValheimMonitor } from "../../modules/valheim/monitor";

export function createClient(): MoxieClient {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] }) as MoxieClient;
  client.webhooks = new WebhookService(new DiscordWebhookDelivery(client));
  client.valheimMonitor = new ValheimMonitor(new DiscordWebhookDelivery(client), undefined, undefined, undefined,
    guildId => client.isReady() && client.guilds.cache.has(guildId), () => [...client.guilds.cache.keys()]);
  client.commands = new Collection(commands.map(command => [command.data.name, command]));
  client.once(Events.ClientReady, readyClient => {
    void ready.execute(readyClient).catch(() => logger.warn("Guild startup sync failed"));
  });
  client.on(Events.GuildCreate, guild => {
    void guildConfiguration.ensureGuild(guild.id)
      .then(() => logger.info("Guild configuration registered", { guildId: guild.id }))
      .catch(() => logger.warn("Guild registration failed; module commands will retry", { guildId: guild.id }));
  });
  client.on(Events.InteractionCreate, interaction => {
    void interactionCreate.execute(interaction).catch(error => logger.error("Interaction event failed", error));
  });
  client.on(Events.Error, error => logger.error("Discord client error", error));
  client.on(Events.Warn, warning => logger.warn("Discord client warning", { warning }));
  client.on(Events.ShardError, (error, shardId) => logger.error("Discord shard error", error, { shardId }));
  return client;
}
