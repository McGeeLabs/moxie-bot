import { ChannelType, MessageFlags, type ChatInputCommandInteraction, type SlashCommandSubcommandGroupBuilder } from "discord.js";
import type { MoxieClient } from "../../types";
import { WebhookError, type WebhookService } from "../../integrations/webhooks/service";
import { logger } from "../../core/logger";
import { webhookProviders, providerName, type WebhookProvider } from "../../integrations/webhooks/providers";

export function buildWebhookCommands(group: SlashCommandSubcommandGroupBuilder) {
  return group.setName("webhook").setDescription("Manage this server's incoming webhook destinations")
    .addSubcommand(command => command.setName("create").setDescription("Create a webhook; token is shown once")
      .addStringOption(option => option.setName("name").setDescription("1–40 lowercase letters, digits, underscores, or hyphens").setMinLength(1).setMaxLength(40).setRequired(true))
      .addChannelOption(option => option.setName("channel").setDescription("Text channel for notifications").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(option => option.setName("provider").setDescription("Payload format (default: Generic)").addChoices(...webhookProviders)))
    .addSubcommand(command => command.setName("list").setDescription("List this server's webhook destinations (up to 10)"))
    .addSubcommand(command => command.setName("rotate").setDescription("Replace a webhook token; old token stops working")
      .addStringOption(option => option.setName("name").setDescription("Webhook name").setRequired(true)))
    .addSubcommand(command => command.setName("delete").setDescription("Delete a webhook destination")
      .addStringOption(option => option.setName("name").setDescription("Webhook name").setRequired(true)));
}

// Called after the shared Administrator guard in the /moxie command.
export async function execute(interaction: ChatInputCommandInteraction, service: WebhookService = (interaction.client as MoxieClient).webhooks) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId!;
  const action = interaction.options.getSubcommand();
  try {
    if (action === "list") {
      const routes = await service.listRoutes(guildId);
      await interaction.editReply({ content: routes.length ? ["**Webhooks — this server (first 10)**", ...routes.map(route =>
        `• **${route.name}** (${providerName(route.provider)}) → <#${route.channelId}>\n\`/webhooks/${route.id}\``)].join("\n") : "No webhook destinations configured. Use /moxie webhook create." });
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
      "Enable the server's webhooks module with /moxie module and start the listener with WEBHOOK_ENABLED=true.",
      ...(route.provider === "uptimeKuma" ? ["Also enable this server's uptimeKuma module with /moxie module."] : []),
    ].join("\n") });
  } catch (error) {
    if (error instanceof WebhookError) await interaction.editReply({ content: error.message });
    else throw error;
  }
}
