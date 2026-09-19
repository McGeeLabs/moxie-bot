import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { kick } from "./actions";
export const ephemeral = true;
export const data = new SlashCommandBuilder().setName("kick").setDescription("Remove a member from this server")
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption(option => option.setName("member").setDescription("Member to kick").setRequired(true))
  .addStringOption(option => option.setName("reason").setDescription("Reason for the kick").setMaxLength(500));
export const execute = (interaction: ChatInputCommandInteraction) => kick(interaction);
