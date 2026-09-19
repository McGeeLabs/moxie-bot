import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember, type PermissionResolvable } from "discord.js";
import { ModerationError } from "./service";

export async function requirePermission(interaction: ChatInputCommandInteraction, permission: PermissionResolvable, label: string): Promise<boolean> {
  if (interaction.inGuild() && interaction.memberPermissions?.has(permission)) return true;
  const response = { content: `This command requires ${label} permission in a server.` };
  if (interaction.deferred) await interaction.editReply(response);
  else await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
  return false;
}

export const requireModerator = (interaction: ChatInputCommandInteraction) =>
  requirePermission(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members");

export type DiscordModerationAction = "none" | "timeout" | "kick" | "ban";

export function assertTargetHierarchy(actor: GuildMember, target: GuildMember, bot: GuildMember,
  action: DiscordModerationAction | boolean = "none"): void {
  const resolved = action === true ? "timeout" : action === false ? "none" : action;
  if (actor.id === target.id) throw new ModerationError("You cannot moderate yourself.");
  if (target.user.bot) throw new ModerationError("Bot accounts cannot be targeted by this command.");
  if (target.id === target.guild.ownerId) throw new ModerationError("The server owner cannot be moderated.");
  if (actor.id !== actor.guild.ownerId && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new ModerationError("Your highest role must be above the member's highest role.");
  }
  if (resolved === "none") return;
  const rules = {
    timeout: { permission: PermissionFlagsBits.ModerateMembers, label: "Moderate Members", capable: target.moderatable },
    kick: { permission: PermissionFlagsBits.KickMembers, label: "Kick Members", capable: target.kickable },
    ban: { permission: PermissionFlagsBits.BanMembers, label: "Ban Members", capable: target.bannable },
  }[resolved];
  if (!bot.permissions.has(rules.permission)) throw new ModerationError(`Moxie needs ${rules.label} permission for this action.`);
  if (!rules.capable || bot.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new ModerationError("Moxie's highest role must be above the member's highest role.");
  }
}
