import { MessageFlags, type ChatInputCommandInteraction, type SlashCommandSubcommandGroupBuilder } from "discord.js";
import { logger } from "../../core/logger";
import { customCommandService, CustomCommandError, type CustomCommandService } from "./service";

export function buildCustomCommandCommands(group: SlashCommandSubcommandGroupBuilder) {
  return group.setName("command").setDescription("Manage saved text responses in this server")
    .addSubcommand(command => command.setName("add").setDescription("Create a custom command")
      .addStringOption(option => option.setName("name").setDescription("1–32 lowercase letters, digits, underscores, or hyphens").setRequired(true).setMaxLength(32))
      .addStringOption(option => option.setName("response").setDescription("Text to post when members run the command").setRequired(true).setMaxLength(1800)))
    .addSubcommand(command => command.setName("edit").setDescription("Change a custom command response")
      .addStringOption(option => option.setName("name").setDescription("Saved command name").setRequired(true))
      .addStringOption(option => option.setName("response").setDescription("Replacement text").setRequired(true).setMaxLength(1800)))
    .addSubcommand(command => command.setName("delete").setDescription("Delete a custom command")
      .addStringOption(option => option.setName("name").setDescription("Saved command name").setRequired(true)))
    .addSubcommand(command => command.setName("list").setDescription("List this server's custom commands"));
}

// The shared /moxie Administrator guard runs before this handler.
export async function execute(interaction: ChatInputCommandInteraction, service: CustomCommandService = customCommandService) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId!;
  const action = interaction.options.getSubcommand();
  try {
    if (action === "list") {
      const commands = await service.list(guildId);
      await interaction.editReply({ content: commands.length
        ? `**Custom commands — this server**\n${commands.map(command => `• \`${command.name}\``).join("\n")}`
        : "No custom commands configured. Use /moxie command add." });
      return;
    }
    const name = interaction.options.getString("name", true);
    const normalized = action === "add"
      ? await service.add(guildId, name, interaction.options.getString("response", true), interaction.user.id)
      : action === "edit"
        ? await service.edit(guildId, name, interaction.options.getString("response", true), interaction.user.id)
        : action === "delete" ? await service.delete(guildId, name) : undefined;
    if (!normalized) throw new CustomCommandError("Unknown command action.");
    logger.info("Custom command changed", { guildId, name: normalized, action, actorId: interaction.user.id });
    await interaction.editReply({ content: `Custom command \`${normalized}\` ${action === "delete" ? "deleted" : action === "add" ? "created" : "updated"}.` });
  } catch (error) {
    if (error instanceof CustomCommandError) await interaction.editReply({ content: error.message });
    else throw error;
  }
}
