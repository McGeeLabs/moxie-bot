import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { DiscordWebhookDelivery } from "../../integrations/webhooks/discordDelivery";
import { WebhookError } from "../../integrations/webhooks/errors";
import { logger } from "../../core/logger";
import { moderationService, type ModerationService } from "./service";

export async function execute(interaction: ChatInputCommandInteraction, service: ModerationService = moderationService,
  destination = new DiscordWebhookDelivery(interaction.client)) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId!;
  const action = interaction.options.getSubcommand();
  try {
    if (action === "configure") {
      const channelId = interaction.options.getChannel("channel", true).id;
      await destination.validateDestination(guildId, channelId, true);
      await service.configure(guildId, channelId);
      logger.info("Moderation log channel configured", { guildId, channelId, actorId: interaction.user.id });
      await interaction.editReply({ content: `Moderation logs will be sent to <#${channelId}>. Enable the moderation module with /module before using moderator commands.` });
      return;
    }
    if (action === "config") {
      const config = await service.getConfig(guildId);
      await interaction.editReply({ content: config ? `Moderation log channel: <#${config.logChannelId}>` : "No moderation log channel configured. Use /moderation configure." });
      return;
    }
    if (action !== "remove") throw new Error("Unknown moderation configuration action");
    await service.removeConfig(guildId);
    logger.info("Moderation log channel removed", { guildId, actorId: interaction.user.id });
    await interaction.editReply({ content: "Moderation log channel configuration removed. Existing warning history was retained." });
  } catch (error) {
    if (error instanceof WebhookError) await interaction.editReply({ content: error.message });
    else throw error;
  }
}
