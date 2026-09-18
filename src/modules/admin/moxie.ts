import { MessageFlags, SlashCommandBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { requireGuildAdministrator } from "../../core/permissions";
import { guildConfiguration, type GuildConfiguration } from "../../core/database/guildConfiguration";
import { logger } from "../../core/logger";
import { moduleDefinitions } from "../definitions";
import { execute as health } from "./health";
import { buildWebhookCommands, execute as webhookCommand } from "./webhooks";

export const data = new SlashCommandBuilder()
  .setName("moxie")
  .setDescription("Moxie diagnostics and administration")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand(command => command.setName("health").setDescription("Check Moxie's runtime health"))
  .addSubcommand(command => command.setName("modules").setDescription("List this server's modules"))
  .addSubcommand(command => command.setName("module").setDescription("Enable or disable a module in this server")
    .addStringOption(option => option.setName("name").setDescription("Module to configure").setRequired(true)
      .addChoices(...moduleDefinitions.filter(module => !module.required).map(module => ({ name: module.name, value: module.name }))))
    .addBooleanOption(option => option.setName("enabled").setDescription("Whether the module should be enabled").setRequired(true)))
  .addSubcommandGroup(buildWebhookCommands);

export async function execute(interaction: ChatInputCommandInteraction, configuration: GuildConfiguration = guildConfiguration) {
  if (!await requireGuildAdministrator(interaction)) return;
  if (interaction.options.getSubcommandGroup?.(false) === "webhook") {
    await webhookCommand(interaction);
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "health") {
    await health(interaction);
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId!;
  if (subcommand === "modules") {
    const states = await configuration.listModules(guildId);
    await interaction.editReply({ content: ["**Moxie Modules — this server**", ...states.map(module =>
      `• **${module.name}**: ${module.enabled ? "Enabled" : "Disabled"}${module.required ? " (required)" : ""}`)].join("\n") });
    return;
  }
  if (subcommand !== "module") throw new Error("Unknown Moxie subcommand");
  const moduleName = interaction.options.getString("name", true);
  const enabled = interaction.options.getBoolean("enabled", true);
  await configuration.setEnabled(guildId, moduleName, enabled);
  logger.info("Guild module setting changed", { guildId, module: moduleName, enabled, actorId: interaction.user.id });
  await interaction.editReply({ content: `Module **${moduleName}** is now **${enabled ? "enabled" : "disabled"}** in this server.` });
}
