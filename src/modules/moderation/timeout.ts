import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { timeout } from "./actions";

export const ephemeral = true;
export const data = new SlashCommandBuilder().setName("timeout").setDescription("Temporarily prevent a member from communicating")
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(option => option.setName("member").setDescription("Member to time out").setRequired(true))
  .addIntegerOption(option => option.setName("minutes").setDescription("Duration in minutes (maximum 28 days)").setRequired(true).setMinValue(1).setMaxValue(40320))
  .addStringOption(option => option.setName("reason").setDescription("Reason for the timeout").setMaxLength(500));
export const execute = (interaction: ChatInputCommandInteraction) => timeout(interaction);
