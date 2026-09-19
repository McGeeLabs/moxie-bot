import { MessageFlags, type Interaction } from "discord.js";
import type { MoxieClient } from "../../types";
import { logger } from "../logger";
import { guildConfiguration, ConfigurationUnavailableError, type GuildConfiguration } from "../database/guildConfiguration";
import { moduleDefinitions } from "../../modules/definitions";
import { customCommandService, type CustomCommandService } from "../../modules/customCommands/service";

export const name = "interactionCreate";
export const once = false;

export async function execute(interaction: Interaction, configuration: GuildConfiguration = guildConfiguration,
  customCommands: CustomCommandService = customCommandService) {
  if (!interaction.isChatInputCommand()) return;

  const client = interaction.client as MoxieClient;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) {
    if (interaction.guildId) {
      try {
        const saved = await customCommands.get(interaction.guildId, interaction.commandName);
        if (saved) {
          await interaction.deferReply();
          if (!await configuration.isEnabled(interaction.guildId, "customCommands")) {
            await interaction.editReply({ content: "Custom commands are disabled in this server. An administrator can enable them with /module.",
              allowedMentions: { parse: [] } });
            return;
          }
          await interaction.editReply({ content: saved.content, allowedMentions: { parse: [] } });
          logger.info("Custom command used", { guildId: interaction.guildId, name: saved.name });
          return;
        }
      } catch (error) {
        logger.error("Custom command failed", error, { guildId: interaction.guildId, name: interaction.commandName });
        if (interaction.deferred) await interaction.editReply({ content: "Custom command is temporarily unavailable." });
        else await interaction.reply({ content: "Custom command is temporarily unavailable.", flags: MessageFlags.Ephemeral });
        return;
      }
    }
    logger.warn("Unknown command received", { command: interaction.commandName, guildId: interaction.guildId });
    await interaction.reply({ content: "This command is unavailable. Ask the bot operator to redeploy commands.", flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const module = moduleDefinitions.find(module => module.name === cmd.module);
    const valheimAdmin = cmd.module === "valheim" && (interaction.options?.getSubcommand?.() ?? "status") !== "status";
    if (module && !module.required && !valheimAdmin) {
      if (!interaction.guildId) {
        await interaction.reply({ content: "This module is available in servers only.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply(cmd.ephemeral ? { flags: MessageFlags.Ephemeral } : undefined);
      if (!await configuration.isEnabled(interaction.guildId, module.name)) {
        await interaction.editReply({ content: `The **${module.name}** module is disabled in this server. An administrator can enable it with /module.` });
        return;
      }
    }
    await cmd.execute(interaction);
  } catch (err) {
    logger.error("Command failed", err, { command: interaction.commandName, guildId: interaction.guildId });
    const msg = err instanceof ConfigurationUnavailableError ? err.message : "⚠️ Command failed.";
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: msg });
      } else if (interaction.replied) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      logger.error("Could not send command error response", replyError, { command: interaction.commandName, guildId: interaction.guildId });
    }
  }
}
