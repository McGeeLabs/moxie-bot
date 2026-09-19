import type { PrismaClient } from "../../generated/prisma/client";
import { ConfigurationUnavailableError, guildConfiguration, type GuildConfiguration } from "../../core/database/guildConfiguration";
import { getDatabase } from "../../core/database";
import { logger } from "../../core/logger";

type Database = Pick<PrismaClient, "moderationConfig" | "moderationCase">;
export type ModerationAction = "warn" | "timeout" | "untimeout" | "kick" | "ban";
export type ModerationCase = {
  id: string; guildId: string; targetUserId: string; moderatorUserId: string;
  action: ModerationAction; reason: string; durationMinutes: number | null;
  createdAt: Date; updatedAt: Date; reasonUpdatedAt: Date | null; reasonUpdatedById: string | null;
};

export class ModerationError extends Error {
  constructor(message: string) { super(message); this.name = "ModerationError"; }
}

export function normalizeReason(value: string | null | undefined): string {
  const reason = value?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!reason) return "No reason provided.";
  if (reason.length > 500) throw new ModerationError("The reason must be 500 characters or fewer.");
  return reason;
}

export class ModerationService {
  constructor(private readonly databaseProvider: () => Database | undefined = getDatabase,
    private readonly configuration: GuildConfiguration = guildConfiguration) {}

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

  async requireConfig(guildId: string) {
    const config = await this.getConfig(guildId);
    if (!config) throw new ModerationError("No moderation log channel is configured. An administrator can set one with /moxie moderation configure.");
    return config;
  }

  async removeConfig(guildId: string): Promise<void> {
    await this.storage(guildId, database => database.moderationConfig.deleteMany({ where: { guildId } }));
  }

  async createCase(guildId: string, targetUserId: string, moderatorUserId: string, action: ModerationAction,
    rawReason: string | null | undefined, durationMinutes?: number): Promise<ModerationCase> {
    const reason = normalizeReason(rawReason);
    await this.requireConfig(guildId);
    return this.storage(guildId, database => database.moderationCase.create({
      data: { guildId, targetUserId, moderatorUserId, action, reason, ...(durationMinutes === undefined ? {} : { durationMinutes }) },
    })) as Promise<ModerationCase>;
  }

  addWarning(guildId: string, targetUserId: string, moderatorUserId: string, rawReason: string): Promise<ModerationCase> {
    return this.createCase(guildId, targetUserId, moderatorUserId, "warn", rawReason);
  }

  async cases(guildId: string, targetUserId: string, limit = 10, action?: ModerationAction): Promise<{ total: number; records: ModerationCase[] }> {
    return this.storage(guildId, async database => {
      const where = { guildId, targetUserId, ...(action ? { action } : {}) };
      const [total, records] = await Promise.all([
        database.moderationCase.count({ where }),
        database.moderationCase.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Math.min(25, Math.max(1, limit)) }),
      ]);
      return { total, records: records as ModerationCase[] };
    });
  }

  warnings(guildId: string, targetUserId: string, limit = 10) { return this.cases(guildId, targetUserId, limit, "warn"); }

  getCase(guildId: string, id: string): Promise<ModerationCase | null> {
    return this.storage(guildId, database => database.moderationCase.findFirst({ where: { guildId, id } })) as Promise<ModerationCase | null>;
  }

  async updateReason(guildId: string, id: string, rawReason: string, editorUserId: string): Promise<ModerationCase> {
    const reason = normalizeReason(rawReason);
    if (!await this.getCase(guildId, id)) throw new ModerationError("No moderation case with that ID exists in this server.");
    await this.storage(guildId, database => database.moderationCase.updateMany({
      where: { guildId, id }, data: { reason, reasonUpdatedAt: new Date(), reasonUpdatedById: editorUserId },
    }));
    return (await this.getCase(guildId, id))!;
  }
}

export const moderationService = new ModerationService();
