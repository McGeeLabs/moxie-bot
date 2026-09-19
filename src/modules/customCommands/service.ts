import type { PrismaClient } from "../../generated/prisma/client";
import { getDatabase } from "../../core/database";
import { guildConfiguration } from "../../core/database/guildConfiguration";
import { logger } from "../../core/logger";

type Database = Pick<PrismaClient, "customCommand">;
export type SavedCommand = { name: string; content: string };

export class CustomCommandError extends Error {
  constructor(message: string) { super(message); this.name = "CustomCommandError"; }
}

function validName(name: string): string {
  const value = name.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)) {
    throw new CustomCommandError("Names must be 1–32 lowercase letters, digits, underscores, or hyphens, starting with a letter or digit.");
  }
  return value;
}

function validContent(content: string): string {
  const value = content.trim();
  if (!value || value.length > 1800) throw new CustomCommandError("Responses must be 1–1800 characters.");
  return value;
}

export class CustomCommandService {
  constructor(private readonly databaseProvider: () => Database | undefined = getDatabase,
    private readonly ensureGuild: (guildId: string) => Promise<void> = guildId => guildConfiguration.ensureGuild(guildId)) {}

  private async storage<T>(guildId: string, action: (database: Database) => Promise<T>): Promise<T> {
    try {
      const database = this.databaseProvider();
      if (!database) throw new CustomCommandError("Custom commands need a database connection.");
      return await action(database);
    }
    catch (error) {
      if (error instanceof CustomCommandError) throw error;
      logger.warn("Custom command storage failed", { guildId });
      throw new CustomCommandError("Custom commands are unavailable. Try again shortly.");
    }
  }

  async list(guildId: string): Promise<SavedCommand[]> {
    return this.storage(guildId, database => database.customCommand.findMany({
      where: { guildId }, orderBy: { name: "asc" }, select: { name: true, content: true }, take: 50,
    }));
  }

  async get(guildId: string, name: string): Promise<SavedCommand | null> {
    const normalized = validName(name);
    return this.storage(guildId, database => database.customCommand.findUnique({
      where: { guildId_name: { guildId, name: normalized } }, select: { name: true, content: true },
    }));
  }

  async add(guildId: string, name: string, content: string, actorId: string): Promise<string> {
    const normalized = validName(name);
    const response = validContent(content);
    await this.ensureGuild(guildId);
    return this.storage(guildId, async database => {
      if (await database.customCommand.findUnique({ where: { guildId_name: { guildId, name: normalized } }, select: { id: true } })) {
        throw new CustomCommandError("A command with that name already exists in this server.");
      }
      if (await database.customCommand.count({ where: { guildId } }) >= 50) {
        throw new CustomCommandError("This server has reached the 50 custom-command limit.");
      }
      await database.customCommand.create({ data: { guildId, name: normalized, content: response,
        createdById: actorId, updatedById: actorId } });
      return normalized;
    });
  }

  async edit(guildId: string, name: string, content: string, actorId: string): Promise<string> {
    const normalized = validName(name);
    const response = validContent(content);
    return this.storage(guildId, async database => {
      const result = await database.customCommand.updateMany({
        where: { guildId, name: normalized }, data: { content: response, updatedById: actorId },
      });
      if (!result.count) throw new CustomCommandError("No command with that name exists in this server.");
      return normalized;
    });
  }

  async delete(guildId: string, name: string): Promise<string> {
    const normalized = validName(name);
    return this.storage(guildId, async database => {
      const result = await database.customCommand.deleteMany({ where: { guildId, name: normalized } });
      if (!result.count) throw new CustomCommandError("No command with that name exists in this server.");
      return normalized;
    });
  }
}

export const customCommandService = new CustomCommandService();
