import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { customCommandService, CustomCommandError, type CustomCommandService } from "./service";

export const data = new SlashCommandBuilder()
  .setName("cmd")
  .setDescription("Run or list this server's custom commands")
  .setDMPermission(false)
  .addSubcommand(command => command.setName("run").setDescription("Post a saved response")
    .addStringOption(option => option.setName("name").setDescription("Custom command name").setRequired(true)))
  .addSubcommand(command => command.setName("list").setDescription("List saved command names"));

export async function execute(interaction: ChatInputCommandInteraction, service: CustomCommandService = customCommandService) {
  if (!interaction.guildId) {
    await interaction.editReply({ content: "Custom commands are available in servers only." });
    return;
  }
  if (!interaction.deferred) await interaction.deferReply();
  try {
    if (interaction.options.getSubcommand() === "list") {
      const commands = await service.list(interaction.guildId);
      await interaction.editReply({ content: commands.length
        ? `**Custom commands**\n${commands.map(command => `• \`${command.name}\``).join("\n")}`
        : "No custom commands yet. An administrator can add one with /moxie command add.",
        allowedMentions: { parse: [] } });
      return;
    }
    const name = interaction.options.getString("name", true);
    const command = await service.get(interaction.guildId, name);
    await interaction.editReply({ content: command?.content ?? "No custom command with that name exists in this server.",
      allowedMentions: { parse: [] } });
  } catch (error) {
    if (error instanceof CustomCommandError) await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } });
    else throw error;
  }
}
