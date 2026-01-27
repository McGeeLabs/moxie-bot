import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("about")
  .setDescription("About Moxie (version, uptime, support)");

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400); seconds %= 86400;
  const h = Math.floor(seconds / 3600);  seconds %= 3600;
  const m = Math.floor(seconds / 60);    seconds %= 60;

  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const version = process.env.npm_package_version ?? "0.1.0";
  const uptime = formatUptime(Math.floor(process.uptime()));
  const wsPing = Math.round(interaction.client.ws.ping);

  const t0 = Date.now();
  await interaction.reply({ content: "Gathering info… 🛰️" });
  const apiMs = Date.now() - t0;

  await interaction.editReply(
    [
      "**Moxie** 🤖",
      "",
      `• Version: \`v${version}\``,
      `• Uptime: \`${uptime}\``,
      `• API Latency: \`~${apiMs}ms\``,
      `• WS Ping: \`${wsPing}ms\``,
      "",
      "💖 **Support the project**",
      "Moxie is 100% open source and free to self-host.",
      "If you find it useful:",
      "👉 https://github.com/sponsors/McGeeLabs",
    ].join("\n")
  );
}
