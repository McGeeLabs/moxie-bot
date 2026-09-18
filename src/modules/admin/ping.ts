import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Replies with pong + latency");

export async function execute(interaction: ChatInputCommandInteraction) {
  const t0 = Date.now();
  await interaction.reply({ content: "Pong! 🛰️" });
  const ms = Date.now() - t0;
  await interaction.editReply(`Pong! 🛰️  (~${ms}ms)`);
}
