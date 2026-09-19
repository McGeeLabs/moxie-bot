import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { warn } from "./actions";

export const ephemeral = true;
export const data = new SlashCommandBuilder().setName("warn").setDescription("Record a warning for a member")
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(option => option.setName("member").setDescription("Member to warn").setRequired(true))
  .addStringOption(option => option.setName("reason").setDescription("Reason for the warning").setRequired(true).setMaxLength(500));
export const execute = (interaction: ChatInputCommandInteraction) => warn(interaction);
