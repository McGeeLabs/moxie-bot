import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { PrismaClient } from "../../generated/prisma/client";
import { getDatabase, disconnectDatabase } from "./index";

type Database = Pick<PrismaClient, "guild" | "guildModuleConfig" | "webhookRoute" | "valheimServerConfig" | "moderationConfig" | "moderationWarning">;

export async function persistenceSnapshot(database: Database) {
  const [guilds, modules, webhooks, valheim, moderation, warnings] = await Promise.all([
    database.guild.findMany({ select: { id: true } }),
    database.guildModuleConfig.findMany({ select: { guildId: true, module: true, enabled: true } }),
    database.webhookRoute.findMany({ select: { id: true, guildId: true, name: true, channelId: true, provider: true, secretHash: true } }),
    database.valheimServerConfig.findMany({ select: { guildId: true, host: true, gamePort: true, queryPort: true, channelId: true } }),
    database.moderationConfig.findMany({ select: { guildId: true, logChannelId: true } }),
    database.moderationWarning.findMany({ select: { id: true, guildId: true, targetUserId: true, moderatorUserId: true, reason: true, createdAt: true } }),
  ]);
  const canonical = (rows: unknown[]) => rows.map(row => JSON.stringify(row, Object.keys(row as object).sort())).sort();
  const digest = createHash("sha256").update(JSON.stringify({ guilds: canonical(guilds), modules: canonical(modules),
    webhooks: canonical(webhooks), valheim: canonical(valheim), moderation: canonical(moderation), warnings: canonical(warnings) })).digest("hex");
  // Only counts and a combined digest leave this process. Never export tokens,
  // individual secret hashes, database credentials, or configuration values.
  return { version: 1, digest, counts: { guilds: guilds.length, modules: modules.length, webhooks: webhooks.length, valheim: valheim.length,
    moderation: moderation.length, warnings: warnings.length } };
}

async function main() {
  const [action, filename, ...extra] = process.argv.slice(2);
  if (extra.length || !["snapshot", "verify"].includes(action) || (action === "verify" && !filename) || (action === "snapshot" && filename)) {
    throw new Error("Usage: verifyPersistence.js snapshot | verify SNAPSHOT_FILE");
  }
  const database = getDatabase();
  if (!database) throw new Error("Missing database");
  const snapshot = await database.$transaction(tx => persistenceSnapshot(tx), { isolationLevel: "RepeatableRead", timeout: 10000 });
  if (action === "snapshot") console.log(JSON.stringify(snapshot));
  else {
    if ((await stat(filename)).size > 8192) throw new Error("Invalid snapshot");
    const previous = JSON.parse(await readFile(filename, "utf8"));
    if (previous.version !== 1 || typeof previous.digest !== "string" || !/^[a-f0-9]{64}$/.test(previous.digest)) throw new Error("Invalid snapshot");
    if (previous.digest !== snapshot.digest) throw new Error("Configuration changed");
    console.log("Saved guild settings, webhook routes/token hashes, Valheim configuration, moderation settings, and warning history match the snapshot.");
  }
}

if (require.main === module) {
  void main().catch(() => {
    console.error("Persistence verification failed. Check the snapshot, database/migrations, or intentional configuration changes; credentials omitted.");
    process.exitCode = 1;
  }).finally(disconnectDatabase);
}
