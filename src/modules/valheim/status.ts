import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { logger } from "../../core/logger";
import { statusEmbed } from "./commands";
import { valheimService, ValheimError, type ValheimService } from "./service";

export const data = new SlashCommandBuilder()
  .setName("valheim")
  .setDescription("Check this server's Valheim host")
  .setDMPermission(false)
  .addSubcommand(command => command.setName("status").setDescription("Show the configured Valheim server's status"));

export async function execute(interaction: ChatInputCommandInteraction, service: ValheimService = valheimService) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Valheim status is available in servers only.", flags: MessageFlags.Ephemeral });
    return;
  }
  // The module dispatcher normally acknowledges before checking guild settings.
  if (!interaction.deferred) await interaction.deferReply();
  try {
    const { config, result } = await service.status(interaction.guildId);
    await interaction.editReply({ embeds: [statusEmbed(config, result)], allowedMentions: { parse: [] } });
    logger.info("Valheim status checked", { guildId: interaction.guildId, status: result.status });
  } catch (error) {
    if (error instanceof ValheimError) {
      await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } });
    } else throw error;
  }
}
