import type { PrismaClient } from "../../generated/prisma/client";
import { moduleDefinitions } from "../../modules/definitions";
import { getDatabase } from "./index";
import { logger } from "../logger";

type ConfigDatabase = Pick<PrismaClient, "guild" | "guildModuleConfig">;
export type ModuleState = { name: string; enabled: boolean; required: boolean };

export class ConfigurationUnavailableError extends Error {
  constructor() {
    super("Guild configuration is unavailable. Check the database connection and migrations.");
    this.name = "ConfigurationUnavailableError";
  }
}

export class GuildConfiguration {
  constructor(private readonly databaseProvider: () => ConfigDatabase | undefined = getDatabase) {}

  private async query<T>(guildId: string, action: (database: ConfigDatabase) => Promise<T>): Promise<T> {
    try {
      const database = this.databaseProvider();
      if (!database) throw new ConfigurationUnavailableError();
      return await action(database);
    } catch {
      // Raw database errors may contain secrets. Report only safe context.
      logger.warn("Guild configuration database operation failed", { guildId });
      throw new ConfigurationUnavailableError();
    }
  }

  async ensureGuild(guildId: string): Promise<void> {
    await this.query(guildId, async database => {
      await database.guild.upsert({ where: { id: guildId }, create: { id: guildId }, update: {} });
      await database.guildModuleConfig.createMany({
        data: moduleDefinitions.filter(module => !module.required).map(module => ({
          guildId, module: module.name, enabled: module.defaultEnabled,
        })),
        skipDuplicates: true,
      });
    });
  }

  async listModules(guildId: string): Promise<ModuleState[]> {
    await this.ensureGuild(guildId);
    const records = await this.query(guildId, database => database.guildModuleConfig.findMany({ where: { guildId } }));
    return moduleDefinitions.map(module => ({
      name: module.name, required: module.required,
      enabled: module.required || (records.find(record => record.module === module.name)?.enabled ?? module.defaultEnabled),
    }));
  }

  async isEnabled(guildId: string, moduleName: string): Promise<boolean> {
    const definition = moduleDefinitions.find(module => module.name === moduleName);
    if (!definition) throw new Error("Unknown module");
    if (definition.required) return true;
    const states = await this.listModules(guildId);
    return states.find(module => module.name === moduleName)!.enabled;
  }

  async setEnabled(guildId: string, moduleName: string, enabled: boolean): Promise<void> {
    const definition = moduleDefinitions.find(module => module.name === moduleName);
    if (!definition) throw new Error("Unknown module");
    if (definition.required) throw new Error("This module is required and cannot be disabled");
    await this.ensureGuild(guildId);
    await this.query(guildId, database => database.guildModuleConfig.upsert({
      where: { guildId_module: { guildId, module: moduleName } },
      create: { guildId, module: moduleName, enabled }, update: { enabled },
    }));
  }
}

export const guildConfiguration = new GuildConfiguration();
