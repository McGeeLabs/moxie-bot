import type {
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { WebhookService } from "./integrations/webhooks/service";

export type Command = {
  module?: string;
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

export type BotModule = {
  name: string;
  required: boolean;
  defaultEnabled: boolean;
  commands: readonly Command[];
};

export type MoxieClient = Client & {
  webhooks: WebhookService;
  commands: Collection<string, Command>;
};
