import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { editReason } from "./actions";
export const ephemeral = true;
export const data = new SlashCommandBuilder().setName("reason").setDescription("Correct a moderation case reason")
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addStringOption(option => option.setName("id").setDescription("Case ID").setRequired(true).setMaxLength(64))
  .addStringOption(option => option.setName("reason").setDescription("Corrected reason").setRequired(true).setMaxLength(500));
export const execute = (interaction: ChatInputCommandInteraction) => editReason(interaction);
