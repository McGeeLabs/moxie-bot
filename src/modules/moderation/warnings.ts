import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { listWarnings } from "./actions";

export const ephemeral = true;
export const data = new SlashCommandBuilder().setName("warnings").setDescription("View a member's warning history")
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(option => option.setName("member").setDescription("Member whose warnings to view").setRequired(true));
export const execute = (interaction: ChatInputCommandInteraction) => listWarnings(interaction);
