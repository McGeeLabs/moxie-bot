import type { BotModule, Command } from "../types";
import * as ping from "./admin/ping";
import * as about from "./status/about";
import { adminCommands } from "./admin/standalone";
import * as valheim from "./valheim/status";
import * as warn from "./moderation/warn";
import * as warnings from "./moderation/warnings";
import * as timeout from "./moderation/timeout";
import * as untimeout from "./moderation/untimeout";
import * as cases from "./moderation/cases";
import * as moderationCase from "./moderation/case";
import * as reason from "./moderation/reason";
import * as kick from "./moderation/kick";
import * as ban from "./moderation/ban";
import * as cmd from "./customCommands/cmd";
import { moduleDefinitions } from "./definitions";

// Diagnostics and module controls remain available even when status is disabled.
export const modules: readonly BotModule[] = [
  { ...moduleDefinitions[0], commands: [ping, ...adminCommands] },
  { ...moduleDefinitions[1], commands: [about] },
  { ...moduleDefinitions[2], commands: [] },
  { ...moduleDefinitions[3], commands: [] },
  { ...moduleDefinitions[4], commands: [valheim] },
  { ...moduleDefinitions[5], commands: [warn, warnings, timeout, untimeout, cases, moderationCase, reason, kick, ban] },
  { ...moduleDefinitions[6], commands: [cmd] },
];

export function collectCommands(registeredModules: readonly BotModule[]): Command[] {
  const commands = registeredModules.flatMap(module => module.commands.map(command => ({ ...command, module: module.name })));
  const names = new Set<string>();
  for (const command of commands) {
    if (names.has(command.data.name)) throw new Error(`Duplicate command: ${command.data.name}`);
    names.add(command.data.name);
  }
  return commands;
}

export const commands = collectCommands(modules);
