import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { untimeout } from "./actions";

export const ephemeral = true;
export const data = new SlashCommandBuilder().setName("untimeout").setDescription("Remove a member's communication timeout")
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(option => option.setName("member").setDescription("Member whose timeout to remove").setRequired(true))
  .addStringOption(option => option.setName("reason").setDescription("Reason for removing the timeout").setMaxLength(500));
export const execute = (interaction: ChatInputCommandInteraction) => untimeout(interaction);
