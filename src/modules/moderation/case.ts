import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { showCase } from "./actions";
export const ephemeral = true;
export const data = new SlashCommandBuilder().setName("case").setDescription("View a moderation case")
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addStringOption(option => option.setName("id").setDescription("Case ID").setRequired(true).setMaxLength(64));
export const execute = (interaction: ChatInputCommandInteraction) => showCase(interaction);
