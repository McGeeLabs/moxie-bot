import { ChannelType, MessageFlags, type ChatInputCommandInteraction, type SlashCommandSubcommandGroupBuilder } from "discord.js";
import { DiscordWebhookDelivery } from "../../integrations/webhooks/discordDelivery";
import { WebhookError } from "../../integrations/webhooks/errors";
import { logger } from "../../core/logger";
import { moderationService, type ModerationService } from "./service";

export function buildModerationCommands(group: SlashCommandSubcommandGroupBuilder) {
  return group.setName("moderation").setDescription("Configure moderation for this server")
    .addSubcommand(command => command.setName("configure").setDescription("Set the moderation log channel")
      .addChannelOption(option => option.setName("channel").setDescription("Channel for moderation audit cards").setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(command => command.setName("config").setDescription("Show the moderation log configuration"))
    .addSubcommand(command => command.setName("remove").setDescription("Remove the moderation log channel configuration"));
}

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
      await interaction.editReply({ content: `Moderation logs will be sent to <#${channelId}>. Enable the moderation module with /moxie module before using moderator commands.` });
      return;
    }
    if (action === "config") {
      const config = await service.getConfig(guildId);
      await interaction.editReply({ content: config ? `Moderation log channel: <#${config.logChannelId}>` : "No moderation log channel configured. Use /moxie moderation configure." });
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
