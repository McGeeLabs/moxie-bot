import "dotenv/config";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  return { token: required(env, "DISCORD_TOKEN") };
}

export function readWebhookConfig(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.WEBHOOK_ENABLED?.trim() || "false";
  if (!["true", "false"].includes(enabled)) throw new Error("WEBHOOK_ENABLED must be true or false");
  if (enabled === "false") return undefined;
  const value = env.WEBHOOK_PORT?.trim() || "3000";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error("WEBHOOK_PORT must be an integer from 1 to 65535");
  }
  return { host: env.WEBHOOK_HOST?.trim() || "127.0.0.1", port: Number(value) };
}

export function readDeploymentConfig(env: NodeJS.ProcessEnv = process.env) {
  const token = required(env, "DISCORD_TOKEN");
  const clientId = required(env, "DISCORD_CLIENT_ID");
  const guildId = required(env, "DISCORD_GUILD_ID");
  for (const [name, value] of Object.entries({ DISCORD_CLIENT_ID: clientId, DISCORD_GUILD_ID: guildId })) {
    if (!/^\d{17,20}$/.test(value)) throw new Error(`${name} must be a Discord ID`);
  }
  return { token, clientId, guildId };
}
