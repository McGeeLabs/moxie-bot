import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { ModerationError } from "./service";

export async function requireModerator(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.inGuild() && interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return true;
  const response = { content: "This command requires Moderate Members permission in a server." };
  if (interaction.deferred) await interaction.editReply(response);
  else await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
  return false;
}

export function assertTargetHierarchy(actor: GuildMember, target: GuildMember, bot: GuildMember, needsDiscordAction: boolean): void {
  if (actor.id === target.id) throw new ModerationError("You cannot moderate yourself.");
  if (target.user.bot) throw new ModerationError("Bot accounts cannot be targeted by this command.");
  if (target.id === target.guild.ownerId) throw new ModerationError("The server owner cannot be moderated.");
  if (actor.id !== actor.guild.ownerId && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new ModerationError("Your highest role must be above the member's highest role.");
  }
  if (needsDiscordAction) {
    if (!bot.permissions.has(PermissionFlagsBits.ModerateMembers)) throw new ModerationError("Moxie needs Moderate Members permission to change timeouts.");
    if (!target.moderatable || bot.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
      throw new ModerationError("Moxie's highest role must be above the member's highest role.");
    }
  }
}
