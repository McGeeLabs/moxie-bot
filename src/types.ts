import type {
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { WebhookService } from "./integrations/webhooks/service";
import type { ValheimMonitor } from "./modules/valheim/monitor";

export type Command = {
  module?: string;
  ephemeral?: boolean;
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

export type BotModule = {
  name: string;
  required: boolean;
  defaultEnabled: boolean;
  commands: readonly Command[];
};

export type MoxieClient = Client & {
  valheimMonitor: ValheimMonitor;
  webhooks: WebhookService;
  commands: Collection<string, Command>;
};
