import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../types";
import { guildConfiguration, type GuildConfiguration } from "../../core/database/guildConfiguration";
import { logger } from "../../core/logger";
import { requireGuildAdministrator } from "../../core/permissions";
import { moduleDefinitions } from "../definitions";
import { execute as health } from "./health";
import { execute as webhook } from "./webhooks";
import { execute as moderation } from "../moderation/admin";
import { execute as customCommand } from "../customCommands/admin";

function adminData(name: string, description: string) {
  return new SlashCommandBuilder().setName(name).setDescription(description)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setDMPermission(false);
}

async function guarded(interaction: ChatInputCommandInteraction, handler: (interaction: ChatInputCommandInteraction) => Promise<void>) {
  if (await requireGuildAdministrator(interaction)) await handler(interaction);
}

const healthCommand: Command = { data: adminData("health", "Check Moxie's runtime health"), execute: health };

export function moduleAdminCommands(configuration: GuildConfiguration = guildConfiguration): readonly Command[] {
const modulesCommand: Command = {
  data: adminData("modules", "List this server's modules"),
  execute: interaction => guarded(interaction, async value => {
    await value.deferReply({ flags: MessageFlags.Ephemeral });
    const states = await configuration.listModules(value.guildId!);
    await value.editReply({ content: ["**Moxie Modules — this server**", ...states.map(module =>
      `• **${module.name}**: ${module.enabled ? "Enabled" : "Disabled"}${module.required ? " (required)" : ""}`)].join("\n") });
  }),
};

const moduleCommand: Command = {
  data: adminData("module", "Enable or disable a module in this server")
    .addStringOption(option => option.setName("name").setDescription("Module to configure").setRequired(true)
      .addChoices(...moduleDefinitions.filter(module => !module.required).map(module => ({ name: module.name, value: module.name }))))
    .addBooleanOption(option => option.setName("enabled").setDescription("Whether the module should be enabled").setRequired(true)),
  execute: interaction => guarded(interaction, async value => {
    await value.deferReply({ flags: MessageFlags.Ephemeral });
    const name = value.options.getString("name", true);
    const enabled = value.options.getBoolean("enabled", true);
    await configuration.setEnabled(value.guildId!, name, enabled);
    logger.info("Guild module setting changed", { guildId: value.guildId!, module: name, enabled, actorId: value.user.id });
    await value.editReply({ content: `Module **${name}** is now **${enabled ? "enabled" : "disabled"}** in this server.` });
  }),
};
return [modulesCommand, moduleCommand];
}

const [modulesCommand, moduleCommand] = moduleAdminCommands();

const webhookCommand: Command = {
  data: adminData("webhook", "Manage this server's incoming webhook destinations")
    .addSubcommand(command => command.setName("create").setDescription("Create a webhook; token is shown once")
      .addStringOption(option => option.setName("name").setDescription("Destination name").setRequired(true).setMaxLength(40))
      .addChannelOption(option => option.setName("channel").setDescription("Text channel for notifications").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(option => option.setName("provider").setDescription("Payload format (default: Generic)")
        .addChoices({ name: "Generic", value: "generic" }, { name: "Uptime Kuma", value: "uptimeKuma" })))
    .addSubcommand(command => command.setName("list").setDescription("List webhook destinations"))
    .addSubcommand(command => command.setName("rotate").setDescription("Replace a webhook token")
      .addStringOption(option => option.setName("name").setDescription("Destination name").setRequired(true)))
    .addSubcommand(command => command.setName("delete").setDescription("Delete a webhook destination")
      .addStringOption(option => option.setName("name").setDescription("Destination name").setRequired(true))),
  execute: interaction => guarded(interaction, webhook),
};

const moderationCommand: Command = {
  data: adminData("moderation", "Configure moderation for this server")
    .addSubcommand(command => command.setName("configure").setDescription("Set the moderation log channel")
      .addChannelOption(option => option.setName("channel").setDescription("Channel for audit cards").setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(command => command.setName("config").setDescription("Show the moderation log configuration"))
    .addSubcommand(command => command.setName("remove").setDescription("Remove the moderation log channel")),
  execute: interaction => guarded(interaction, moderation),
};

const commandManagement: Command = {
  data: adminData("command", "Manage this server's saved responses")
    .addSubcommand(command => command.setName("add").setDescription("Create a custom command")
      .addStringOption(option => option.setName("name").setDescription("Saved command name").setRequired(true).setMaxLength(32))
      .addStringOption(option => option.setName("response").setDescription("Text to post").setRequired(true).setMaxLength(1800)))
    .addSubcommand(command => command.setName("edit").setDescription("Change a saved response")
      .addStringOption(option => option.setName("name").setDescription("Saved command name").setRequired(true))
      .addStringOption(option => option.setName("response").setDescription("Replacement text").setRequired(true).setMaxLength(1800)))
    .addSubcommand(command => command.setName("delete").setDescription("Delete a custom command")
      .addStringOption(option => option.setName("name").setDescription("Saved command name").setRequired(true)))
    .addSubcommand(command => command.setName("list").setDescription("List saved command names"))
    .addSubcommand(command => command.setName("sync").setDescription("Refresh saved slash commands in this server")),
  execute: interaction => guarded(interaction, customCommand),
};

export const adminCommands: readonly Command[] = [healthCommand, modulesCommand, moduleCommand,
  webhookCommand, moderationCommand, commandManagement];
