import { ChannelType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { logger } from "../../core/logger";
import { requireGuildAdministrator } from "../../core/permissions";
import { statusEmbed } from "./commands";
import { execute as adminExecute } from "./commands";
import { valheimService, ValheimError, type ValheimService } from "./service";

export const data = new SlashCommandBuilder()
  .setName("valheim")
  .setDescription("Check this server's Valheim host")
  .setDMPermission(false)
  .addSubcommand(command => command.setName("status").setDescription("Show the configured Valheim server's status"))
  .addSubcommand(command => command.setName("configure").setDescription("Save a Valheim server and monitoring channel")
    .addStringOption(option => option.setName("host").setDescription("Hostname or IP, without port").setRequired(true).setMaxLength(253))
    .addIntegerOption(option => option.setName("game-port").setDescription("Game connection port").setRequired(true).setMinValue(1).setMaxValue(65535))
    .addChannelOption(option => option.setName("channel").setDescription("Channel for scheduled alerts").setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addIntegerOption(option => option.setName("query-port").setDescription("A2S query port (default: game port + 1)").setMinValue(1).setMaxValue(65535)))
  .addSubcommand(command => command.setName("config").setDescription("Show the saved Valheim configuration"))
  .addSubcommand(command => command.setName("remove").setDescription("Remove this server's Valheim configuration"));

export async function execute(interaction: ChatInputCommandInteraction, service: ValheimService = valheimService) {
  if ((interaction.options?.getSubcommand?.() ?? "status") !== "status") {
    if (await requireGuildAdministrator(interaction)) await adminExecute(interaction, service);
    return;
  }
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
