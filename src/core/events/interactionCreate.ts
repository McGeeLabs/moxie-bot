import { MessageFlags, type Interaction } from "discord.js";
import type { MoxieClient } from "../../types";
import { logger } from "../logger";
import { guildConfiguration, ConfigurationUnavailableError, type GuildConfiguration } from "../database/guildConfiguration";
import { moduleDefinitions } from "../../modules/definitions";

export const name = "interactionCreate";
export const once = false;

export async function execute(interaction: Interaction, configuration: GuildConfiguration = guildConfiguration) {
  if (!interaction.isChatInputCommand()) return;

  const client = interaction.client as MoxieClient;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) {
    logger.warn("Unknown command received", { command: interaction.commandName, guildId: interaction.guildId });
    await interaction.reply({ content: "This command is unavailable. Ask the bot operator to redeploy commands.", flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const module = moduleDefinitions.find(module => module.name === cmd.module);
    if (module && !module.required) {
      if (!interaction.guildId) {
        await interaction.reply({ content: "This module is available in servers only.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply(cmd.ephemeral ? { flags: MessageFlags.Ephemeral } : undefined);
      if (!await configuration.isEnabled(interaction.guildId, module.name)) {
        await interaction.editReply({ content: `The **${module.name}** module is disabled in this server. An administrator can enable it with /moxie module.` });
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
