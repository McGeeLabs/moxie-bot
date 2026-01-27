import type {
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
} from "discord.js";

export type Command = {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

export type Event = {
  name: string;
  once?: boolean;
  execute: (...args: any[]) => Promise<void> | void;
};

export type MoxieClient = Client & {
  commands: Collection<string, Command>;
};
