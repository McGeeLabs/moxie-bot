import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { ban } from "./actions";
export const ephemeral = true;
export const data = new SlashCommandBuilder().setName("ban").setDescription("Ban a member from this server")
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption(option => option.setName("member").setDescription("Member to ban").setRequired(true))
  .addStringOption(option => option.setName("reason").setDescription("Reason for the ban").setMaxLength(500));
export const execute = (interaction: ChatInputCommandInteraction) => ban(interaction);
