import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { logger } from "../../core/logger";
import { customCommandService, CustomCommandError, type CustomCommandService } from "./service";
import { syncGuildCommands } from "./registration";
import type { MoxieClient } from "../../types";

// The top-level /command Administrator guard runs before this handler.
export async function execute(interaction: ChatInputCommandInteraction, service: CustomCommandService = customCommandService) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId!;
  const sync = async () => syncGuildCommands(interaction.guild ?? await interaction.client.guilds.fetch(guildId), service);
  const action = interaction.options.getSubcommand();
  try {
    if (action === "list") {
      const commands = await service.list(guildId);
      await interaction.editReply({ content: commands.length
        ? `**Custom commands — this server**\n${commands.map(command => `• \`${command.name}\``).join("\n")}`
        : "No custom commands configured. Use /command add." });
      return;
    }
    if (action === "sync") {
      await sync();
      await interaction.editReply({ content: "This server's slash commands are synchronized." });
      return;
    }
    const name = interaction.options.getString("name", true);
    if (action === "add" && (interaction.client as MoxieClient).commands.has(name.trim().toLowerCase())) {
      throw new CustomCommandError("That name is reserved by a built-in command.");
    }
    const normalized = action === "add"
      ? await service.add(guildId, name, interaction.options.getString("response", true), interaction.user.id)
      : action === "edit"
        ? await service.edit(guildId, name, interaction.options.getString("response", true), interaction.user.id)
        : action === "delete" ? await service.delete(guildId, name) : undefined;
    if (!normalized) throw new CustomCommandError("Unknown command action.");
    logger.info("Custom command changed", { guildId, name: normalized, action, actorId: interaction.user.id });
    if (action === "add" || action === "delete") {
      try { await sync(); }
      catch {
        logger.warn("Custom command registration failed", { guildId, name: normalized, action });
        await interaction.editReply({ content: `The saved command changed, but Discord registration failed. Use /command sync to retry.` });
        return;
      }
    }
    await interaction.editReply({ content: `Custom command \`${normalized}\` ${action === "delete" ? "deleted" : action === "add" ? "created" : "updated"}.` });
  } catch (error) {
    if (error instanceof CustomCommandError) await interaction.editReply({ content: error.message });
    else throw error;
  }
}
