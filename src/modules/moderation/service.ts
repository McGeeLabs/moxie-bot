import type { PrismaClient } from "../../generated/prisma/client";
import { ConfigurationUnavailableError, guildConfiguration, type GuildConfiguration } from "../../core/database/guildConfiguration";
import { getDatabase } from "../../core/database";
import { logger } from "../../core/logger";

type Database = Pick<PrismaClient, "moderationConfig" | "moderationWarning">;

export type WarningRecord = {
  id: string;
  guildId: string;
  targetUserId: string;
  moderatorUserId: string;
  reason: string;
  createdAt: Date;
};

export class ModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModerationError";
  }
}

export function normalizeReason(value: string | null | undefined): string {
  const reason = value?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!reason) return "No reason provided.";
  if (reason.length > 500) throw new ModerationError("The reason must be 500 characters or fewer.");
  return reason;
}

export class ModerationService {
  constructor(
    private readonly databaseProvider: () => Database | undefined = getDatabase,
    private readonly configuration: GuildConfiguration = guildConfiguration,
  ) {}

  private async storage<T>(guildId: string, action: (database: Database) => Promise<T>): Promise<T> {
    try {
      const database = this.databaseProvider();
      if (!database) throw new Error("Missing database");
      return await action(database);
    } catch {
      logger.warn("Moderation storage operation failed", { guildId });
      throw new ConfigurationUnavailableError();
    }
  }

  async configure(guildId: string, logChannelId: string): Promise<void> {
    await this.configuration.ensureGuild(guildId);
    await this.storage(guildId, database => database.moderationConfig.upsert({
      where: { guildId }, create: { guildId, logChannelId }, update: { logChannelId },
    }));
  }

  getConfig(guildId: string) {
    return this.storage(guildId, database => database.moderationConfig.findUnique({
      where: { guildId }, select: { guildId: true, logChannelId: true },
    }));
  }

  async removeConfig(guildId: string): Promise<void> {
    await this.storage(guildId, database => database.moderationConfig.deleteMany({ where: { guildId } }));
  }

  async addWarning(guildId: string, targetUserId: string, moderatorUserId: string, rawReason: string): Promise<WarningRecord> {
    const reason = normalizeReason(rawReason);
    const config = await this.getConfig(guildId);
    if (!config) throw new ModerationError("No moderation log channel is configured. An administrator can set one with /moxie moderation configure.");
    return this.storage(guildId, database => database.moderationWarning.create({
      data: { guildId, targetUserId, moderatorUserId, reason },
      select: { id: true, guildId: true, targetUserId: true, moderatorUserId: true, reason: true, createdAt: true },
    }));
  }

  async warnings(guildId: string, targetUserId: string, limit = 10): Promise<{ total: number; records: WarningRecord[] }> {
    return this.storage(guildId, async database => {
      const where = { guildId, targetUserId };
      const [total, records] = await Promise.all([
        database.moderationWarning.count({ where }),
        database.moderationWarning.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Math.min(25, Math.max(1, limit)),
          select: { id: true, guildId: true, targetUserId: true, moderatorUserId: true, reason: true, createdAt: true } }),
      ]);
      return { total, records };
    });
  }
}

export const moderationService = new ModerationService();
