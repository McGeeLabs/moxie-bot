import { MessageFlags, escapeMarkdown, type APIEmbed, type ChatInputCommandInteraction } from "discord.js";
import { DiscordWebhookDelivery } from "../../integrations/webhooks/discordDelivery";
import { logger } from "../../core/logger";
import { valheimService, ValheimError, type ValheimService, type ValheimConfig } from "./service";
import type { ValheimQueryResult } from "../../integrations/valheim/query";
import { WebhookError } from "../../integrations/webhooks/errors";

function display(value: string, limit = 200): string {
  return escapeMarkdown(value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit)) || "Not reported";
}

export function statusEmbed(config: ValheimConfig, result: ValheimQueryResult): APIEmbed {
  const fields = [
    { name: "Connect", value: `${config.host}:${config.gamePort}`, inline: true },
    { name: "Query port", value: String(config.queryPort), inline: true },
  ];
  if (result.status === "online") {
    fields.unshift({ name: "Server", value: display(result.name), inline: false });
    fields.push(
      { name: "Players (reported)", value: `${result.players} / ${result.maxPlayers}`, inline: true },
      { name: "Query latency", value: `${result.latencyMs} ms`, inline: true },
      { name: "Version (reported)", value: display(result.version, 100), inline: true },
      { name: "Password", value: result.passwordProtected ? "Required" : "Not required", inline: true },
    );
    return { title: "Valheim • Online", description: "The server answered its information query.", color: 0x22c55e, fields,
      footer: { text: "Moxie • Valheim • Results cached for up to 15 seconds" } };
  }
  const reasons = {
    timeout: "No query reply within 5 seconds. The server may be offline, or its query port may be blocked.",
    network: "The query could not reach the host. Check DNS, the query port, and outbound UDP access.",
    invalid_response: "The endpoint returned a malformed or unexpected information packet.",
    unsupported_response: "The endpoint returned a split query packet, which this initial adapter does not support.",
    wrong_game: "The endpoint answered, but did not identify itself as a Valheim server.",
  };
  return { title: "Valheim • Query unavailable", description: reasons[result.reason], color: 0xf59e0b, fields,
    footer: { text: "Moxie • Valheim • A failed query does not prove the game server is offline" } };
}

// /valheim enforces guild Administrator permissions for management subcommands before dispatching here.
export async function execute(interaction: ChatInputCommandInteraction, service: ValheimService = valheimService,
  destination = new DiscordWebhookDelivery(interaction.client)) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId!;
  const action = interaction.options.getSubcommand();
  try {
    if (action === "configure") {
      const gamePort = interaction.options.getInteger("game-port", true);
      const channelId = interaction.options.getChannel("channel", true).id;
      await destination.validateDestination(guildId, channelId);
      await service.configure({ guildId, host: interaction.options.getString("host", true), gamePort,
        queryPort: interaction.options.getInteger("query-port") ?? gamePort + 1, channelId });
      logger.info("Valheim configuration saved", { guildId, actorId: interaction.user.id });
      await interaction.editReply({ content: "Valheim configuration saved. Enable the valheim module for scheduled monitoring every 60 seconds, or run /valheim status. The first stable result establishes a quiet baseline; three failed checks trigger an unavailable alert." });
      return;
    }
    if (action === "config") {
      const config = await service.getConfig(guildId);
      await interaction.editReply({ content: config ? ["**Valheim configuration — this server**",
        `Connect: \`${config.host}:${config.gamePort}\``, `Query port: \`${config.queryPort}\``,
        `Alert channel: <#${config.channelId}>`, "Scheduled checks: Every 60 seconds while the valheim module is enabled"].join("\n") : "No Valheim server configured. Use /valheim configure." });
      return;
    }
    if (action === "remove") {
      await service.remove(guildId);
      logger.info("Valheim configuration removed", { guildId, actorId: interaction.user.id });
      await interaction.editReply({ content: "Valheim configuration removed from this server." });
      return;
    }
    if (action !== "status") throw new ValheimError("Unknown Valheim action.");
    const { config, result } = await service.status(guildId);
    await interaction.editReply({ embeds: [statusEmbed(config, result)], allowedMentions: { parse: [] } });
    logger.info("Valheim status checked", { guildId, status: result.status, ...(result.status === "unavailable" ? { reason: result.reason } : {}) });
  } catch (error) {
    if (error instanceof ValheimError || error instanceof WebhookError) await interaction.editReply({ content: error.message });
    else throw error;
  }
}
