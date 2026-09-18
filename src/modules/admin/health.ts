import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { checkDatabase } from "../../core/database";
import { requireGuildAdministrator } from "../../core/permissions";
import { getWebhookListenerStatus } from "../../integrations/webhooks/server";
import type { MoxieClient } from "../../types";

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!await requireGuildAdministrator(interaction)) return;
  const ping = interaction.client.ws.ping;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const database = await checkDatabase();
  const scheduler = (interaction.client as MoxieClient).valheimMonitor?.status;
  const databaseStatus = database.status === "connected"
    ? `Connected (${database.latencyMs}ms)`
    : database.status === "not_configured" ? "Not configured" : "Unavailable (check connectivity and credentials)";
  await interaction.editReply({
    content: [
      "**Moxie Health**",
      `Discord: ${interaction.client.isReady() ? "Ready" : "Connecting"}`,
      `Process uptime: ${Math.floor(process.uptime())}s`,
      `Gateway latency: ${ping < 0 ? "Not available yet" : `${Math.round(ping)}ms`}`,
      `Database: ${databaseStatus}`,
      `Webhook API: ${getWebhookListenerStatus() ? "Listening" : "Disabled"}`,
      "Service adapters: Uptime Kuma push notifications; Valheim queries and scheduled monitoring",
      `Valheim scheduler: ${scheduler?.running ? "Running (60s)" : "Stopped"}${scheduler?.inProgress ? " — checking" : ""}`,
      ...(scheduler ? [`Last completed cycle: ${scheduler.lastSuccessAt?.toISOString() ?? "Not yet"}`,
        `Last cycle: ${scheduler.checkedLastCycle} checked, ${scheduler.unavailableLastCycle} query failures`,
        `Scheduler errors: ${scheduler.errors}; alert delivery errors: ${scheduler.deliveryErrors}`] : []),
    ].join("\n"),
  });
}
