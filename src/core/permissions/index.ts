import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";

export async function requireGuildAdministrator(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.inGuild() && interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  await interaction.reply({ content: "This command requires Administrator permission in a server.", flags: MessageFlags.Ephemeral });
  return false;
}
