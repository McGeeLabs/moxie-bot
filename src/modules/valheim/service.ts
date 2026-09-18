import { isIP } from "node:net";
import type { PrismaClient } from "../../generated/prisma/client";
import { getDatabase } from "../../core/database";
import { guildConfiguration, type GuildConfiguration, ConfigurationUnavailableError } from "../../core/database/guildConfiguration";
import { logger } from "../../core/logger";
import { queryValheim, type ValheimQueryResult } from "../../integrations/valheim/query";

export class ValheimError extends Error {}
export type ValheimConfig = { guildId: string; host: string; gamePort: number; queryPort: number; channelId: string };
type Database = Pick<PrismaClient, "valheimServerConfig">;

export function normalizeHost(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (isIP(host)) return host;
  if (host.length > 253 || !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new ValheimError("Host must be a hostname or IP address, without a URL, port, or path.");
  }
  return host;
}

export class ValheimService {
  private readonly cache = new Map<string, { config: ValheimConfig; result: ValheimQueryResult; expires: number }>();
  private readonly pending = new Map<string, Promise<{ config: ValheimConfig; result: ValheimQueryResult }>>();

  constructor(
    private readonly databaseProvider: () => Database | undefined = getDatabase,
    private readonly configuration: Pick<GuildConfiguration, "ensureGuild" | "isEnabled"> = guildConfiguration,
    private readonly query = queryValheim,
    private readonly now = Date.now,
  ) {}

  private async storage<T>(guildId: string, action: (database: Database) => Promise<T>): Promise<T> {
    try {
      const database = this.databaseProvider();
      if (!database) throw new Error("Missing database");
      return await action(database);
    } catch {
      logger.warn("Valheim configuration storage failed", { guildId });
      throw new ConfigurationUnavailableError();
    }
  }

  async configure(config: ValheimConfig): Promise<void> {
    const host = normalizeHost(config.host);
    for (const port of [config.gamePort, config.queryPort]) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ValheimError("Ports must be integers from 1 to 65535.");
    }
    await this.configuration.ensureGuild(config.guildId);
    const data = { host, gamePort: config.gamePort, queryPort: config.queryPort, channelId: config.channelId };
    await this.storage(config.guildId, database => database.valheimServerConfig.upsert({
      where: { guildId: config.guildId }, create: { guildId: config.guildId, ...data }, update: data,
    }));
    this.cache.delete(config.guildId);
  }

  async getConfig(guildId: string): Promise<ValheimConfig | null> {
    return this.storage(guildId, database => database.valheimServerConfig.findUnique({
      where: { guildId }, select: { guildId: true, host: true, gamePort: true, queryPort: true, channelId: true },
    }));
  }

  async remove(guildId: string): Promise<void> {
    await this.storage(guildId, database => database.valheimServerConfig.deleteMany({ where: { guildId } }));
    this.cache.delete(guildId);
  }

  async status(guildId: string): Promise<{ config: ValheimConfig; result: ValheimQueryResult }> {
    if (!await this.configuration.isEnabled(guildId, "valheim")) throw new ValheimError("The valheim module is disabled in this server. Enable it with /moxie module.");
    const config = await this.getConfig(guildId);
    if (!config) throw new ValheimError("No Valheim server configured. Use /moxie valheim configure first.");
    const cached = this.cache.get(guildId);
    if (cached && cached.expires > this.now() && JSON.stringify(cached.config) === JSON.stringify(config)) return { config, result: cached.result };
    if (this.pending.has(guildId)) throw new ValheimError("A Valheim check is already running for this server. Try again shortly.");
    if (this.pending.size >= 4) throw new ValheimError("Valheim checks are busy. Try again shortly.");
    for (const [id, value] of this.cache) if (value.expires <= this.now()) this.cache.delete(id);
    const operation = this.query(config.host, config.queryPort).then(result => {
      if (this.cache.size < 1000) this.cache.set(guildId, { config, result, expires: this.now() + 15000 });
      return { config, result };
    });
    this.pending.set(guildId, operation);
    try { return await operation; }
    finally { this.pending.delete(guildId); }
  }
}

export const valheimService = new ValheimService();
