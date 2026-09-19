import { SlashCommandBuilder, type Guild } from "discord.js";
import { customCommandService, type CustomCommandService } from "./service";

export function directCommand(name: string) {
  return new SlashCommandBuilder().setName(name).setDescription("Saved response for this server").setDMPermission(false);
}

export async function guildCommandDefinitions(guildId: string, service: CustomCommandService = customCommandService) {
  const { commands } = await import("../index");
  const saved = await service.list(guildId);
  const names = new Set(commands.map(command => command.data.name));
  for (const row of saved) {
    if (names.has(row.name)) throw new Error(`Custom command name conflicts with a built-in command: ${row.name}`);
    names.add(row.name);
  }
  return [...commands.map(command => command.data.toJSON()), ...saved.map(row => directCommand(row.name).toJSON())];
}

const pending = new Map<string, Promise<void>>();

export async function syncGuildCommands(guild: Guild, service: CustomCommandService = customCommandService): Promise<void> {
  const previous = pending.get(guild.id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const definitions = await guildCommandDefinitions(guild.id, service);
    await guild.commands.set(definitions);
  });
  pending.set(guild.id, next);
  try { await next; }
  finally { if (pending.get(guild.id) === next) pending.delete(guild.id); }
}
