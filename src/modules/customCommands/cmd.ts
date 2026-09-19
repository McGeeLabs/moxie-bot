import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { customCommandService, CustomCommandError, type CustomCommandService } from "./service";

export const data = new SlashCommandBuilder()
  .setName("commands")
  .setDescription("List this server's saved command names")
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction, service: CustomCommandService = customCommandService) {
  if (!interaction.guildId) {
    await interaction.editReply({ content: "Custom commands are available in servers only." });
    return;
  }
  if (!interaction.deferred) await interaction.deferReply();
  try {
    const commands = await service.list(interaction.guildId);
    await interaction.editReply({ content: commands.length
      ? `**Custom commands**\n${commands.map(command => `• \`${command.name}\``).join("\n")}`
      : "No custom commands yet. An administrator can add one with /command add.",
      allowedMentions: { parse: [] } });
  } catch (error) {
    if (error instanceof CustomCommandError) await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } });
    else throw error;
  }
}
