import type { BotModule, Command } from "../types";
import * as ping from "./admin/ping";
import * as about from "./status/about";
import * as moxie from "./admin/moxie";
import { moduleDefinitions } from "./definitions";

// Diagnostics and module controls remain available even when status is disabled.
export const modules: readonly BotModule[] = [
  { ...moduleDefinitions[0], commands: [ping, moxie] },
  { ...moduleDefinitions[1], commands: [about] },
  { ...moduleDefinitions[2], commands: [] },
  { ...moduleDefinitions[3], commands: [] },
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
