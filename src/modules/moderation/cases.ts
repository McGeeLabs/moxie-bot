import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { listCases } from "./actions";
export const ephemeral = true;
export const data = new SlashCommandBuilder().setName("cases").setDescription("View a member's moderation history")
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(option => option.setName("member").setDescription("Member whose cases to view").setRequired(true));
export const execute = (interaction: ChatInputCommandInteraction) => listCases(interaction);
