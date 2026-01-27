import "dotenv/config";

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const CONFIG = {
  token: must("DISCORD_TOKEN"),
  clientId: must("DISCORD_CLIENT_ID"),
  guildId: must("DISCORD_GUILD_ID"), // keep guild deploy for fast iteration
};
