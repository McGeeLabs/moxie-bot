import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { MoxieClient } from "../../types";
import { WebhookError, type WebhookService } from "../../integrations/webhooks/service";
import { logger } from "../../core/logger";
import { providerName, type WebhookProvider } from "../../integrations/webhooks/providers";

// Called after the top-level /webhook Administrator guard.
export async function execute(interaction: ChatInputCommandInteraction, service: WebhookService = (interaction.client as MoxieClient).webhooks) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId!;
  const action = interaction.options.getSubcommand();
  try {
    if (action === "list") {
      const routes = await service.listRoutes(guildId);
      await interaction.editReply({ content: routes.length ? ["**Webhooks — this server (first 10)**", ...routes.map(route =>
        `• **${route.name}** (${providerName(route.provider)}) → <#${route.channelId}>\n\`/webhooks/${route.id}\``)].join("\n") : "No webhook destinations configured. Use /webhook create." });
      return;
    }
    const name = interaction.options.getString("name", true);
    if (action === "delete") {
      await service.deleteRoute(guildId, name);
      logger.info("Webhook route deleted", { guildId, actorId: interaction.user.id });
      await interaction.editReply({ content: `Webhook **${name}** deleted.` });
      return;
    }
    if (action !== "create" && action !== "rotate") throw new WebhookError(400, "Unknown webhook action");
    const route = action === "create"
      ? await service.createRoute(guildId, name, interaction.options.getChannel("channel", true).id,
        (interaction.options.getString("provider") ?? "generic") as WebhookProvider)
      : await service.rotateSecret(guildId, name);
    logger.info(action === "create" ? "Webhook route created" : "Webhook token rotated", { guildId, routeId: route.id, actorId: interaction.user.id });
    await interaction.editReply({ content: [
      `Webhook **${route.name}** (${providerName(route.provider)}) → <#${route.channelId}>`,
      `Path: \`/webhooks/${route.id}\``,
      "**Save this token now. It cannot be retrieved later.**",
      `\`\`\`text\nAuthorization: Bearer ${route.token}\n\`\`\``,
      "Enable the server's webhooks module with /module and start the listener with WEBHOOK_ENABLED=true.",
      ...(route.provider === "uptimeKuma" ? ["Also enable this server's uptimeKuma module with /module."] : []),
    ].join("\n") });
  } catch (error) {
    if (error instanceof WebhookError) await interaction.editReply({ content: error.message });
    else throw error;
  }
}
