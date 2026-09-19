import { MessageFlags, escapeMarkdown, type APIEmbed, type ChatInputCommandInteraction, type User } from "discord.js";
import { DiscordWebhookDelivery } from "../../integrations/webhooks/discordDelivery";
import { WebhookError } from "../../integrations/webhooks/errors";
import { logger } from "../../core/logger";
import { assertTargetHierarchy, requireModerator } from "./permissions";
import { moderationService, ModerationError, normalizeReason, type ModerationService, type WarningRecord } from "./service";

type Delivery = Pick<DiscordWebhookDelivery, "send">;

function safe(value: string, limit = 500): string {
  return escapeMarkdown(value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit)) || "Not provided";
}

async function members(interaction: ChatInputCommandInteraction) {
  const guild = interaction.guild;
  if (!guild) throw new ModerationError("This command is available in servers only.");
  const user = interaction.options.getUser("member", true);
  try {
    const [actor, target, bot] = await Promise.all([
      guild.members.fetch(interaction.user.id), guild.members.fetch(user.id), guild.members.fetchMe(),
    ]);
    return { actor, target, bot, user };
  } catch {
    throw new ModerationError("That member is no longer available in this server.");
  }
}

function logEmbed(action: "Warning" | "Timeout" | "Timeout removed", target: User, moderator: User, reason: string,
  extra?: { caseId?: string; duration?: string }): APIEmbed {
  return {
    title: `Moderation • ${action}`,
    color: action === "Warning" ? 0xf59e0b : action === "Timeout" ? 0xef4444 : 0x22c55e,
    fields: [
      { name: "Member", value: `${safe(target.tag, 100)}\n\`${target.id}\``, inline: true },
      { name: "Moderator", value: `${safe(moderator.tag, 100)}\n\`${moderator.id}\``, inline: true },
      ...(extra?.duration ? [{ name: "Duration", value: extra.duration, inline: true }] : []),
      { name: "Reason", value: safe(reason), inline: false },
      ...(extra?.caseId ? [{ name: "Case ID", value: `\`${extra.caseId}\``, inline: false }] : []),
    ],
    timestamp: new Date().toISOString(), footer: { text: "Moxie • Moderation" },
  };
}

async function sendLog(interaction: ChatInputCommandInteraction, embed: APIEmbed, service: ModerationService, delivery: Delivery): Promise<boolean> {
  const config = await service.getConfig(interaction.guildId!);
  if (!config) return false;
  try {
    await delivery.send(interaction.guildId!, config.logChannelId, "Moderation action", embed);
    return true;
  } catch (error) {
    if (!(error instanceof WebhookError)) throw error;
    logger.warn("Moderation log delivery failed", { guildId: interaction.guildId, action: embed.title ?? "unknown" });
    return false;
  }
}

async function handle(interaction: ChatInputCommandInteraction, action: () => Promise<void>) {
  if (!await requireModerator(interaction)) return;
  if (!interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try { await action(); }
  catch (error) {
    if (error instanceof ModerationError) await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } });
    else throw error;
  }
}

export async function warn(interaction: ChatInputCommandInteraction, service: ModerationService = moderationService,
  delivery: Delivery = new DiscordWebhookDelivery(interaction.client)) {
  await handle(interaction, async () => {
    const { actor, target, bot, user } = await members(interaction);
    assertTargetHierarchy(actor, target, bot, false);
    const record = await service.addWarning(interaction.guildId!, user.id, interaction.user.id, interaction.options.getString("reason", true));
    const logged = await sendLog(interaction, logEmbed("Warning", user, interaction.user, record.reason, { caseId: record.id }), service, delivery);
    logger.info("Member warning recorded", { guildId: interaction.guildId, targetUserId: user.id, moderatorUserId: interaction.user.id, caseId: record.id });
    await interaction.editReply({ content: `Warning recorded for **${safe(user.tag, 100)}**. Case ID: \`${record.id}\`${logged ? "" : "\n⚠️ The warning was saved, but the moderation log could not be delivered."}`,
      allowedMentions: { parse: [] } });
  });
}

export async function listWarnings(interaction: ChatInputCommandInteraction, service: ModerationService = moderationService) {
  await handle(interaction, async () => {
    const { actor, target, bot, user } = await members(interaction);
    assertTargetHierarchy(actor, target, bot, false);
    const result = await service.warnings(interaction.guildId!, user.id);
    const description = result.records.length ? result.records.map((record: WarningRecord) =>
      `**${safe(record.reason, 240)}**\n<t:${Math.floor(record.createdAt.getTime() / 1000)}:f> by <@${record.moderatorUserId}> • \`${record.id}\``).join("\n\n") : "No warnings recorded.";
    await interaction.editReply({ embeds: [{ title: `Warnings • ${safe(user.tag, 100)}`, description, color: 0xf59e0b,
      footer: { text: `${result.total} total warning${result.total === 1 ? "" : "s"} • Showing newest ${result.records.length}` } }], allowedMentions: { parse: [] } });
  });
}

export async function timeout(interaction: ChatInputCommandInteraction, service: ModerationService = moderationService,
  delivery: Delivery = new DiscordWebhookDelivery(interaction.client)) {
  await handle(interaction, async () => {
    const { actor, target, bot, user } = await members(interaction);
    assertTargetHierarchy(actor, target, bot, true);
    const minutes = interaction.options.getInteger("minutes", true);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 40320) throw new ModerationError("Timeout duration must be from 1 to 40,320 minutes (28 days).");
    const reason = normalizeReason(interaction.options.getString("reason"));
    if (!await service.getConfig(interaction.guildId!)) throw new ModerationError("No moderation log channel is configured. An administrator can set one with /moxie moderation configure.");
    try { await target.timeout(minutes * 60_000, `By ${interaction.user.tag} (${interaction.user.id}): ${reason}`.slice(0, 512)); }
    catch { throw new ModerationError("Discord rejected the timeout. Check Moxie's permission and role position, then try again."); }
    const duration = minutes < 60 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : minutes % 1440 === 0 ? `${minutes / 1440} day${minutes === 1440 ? "" : "s"}` : `${Math.round(minutes / 60 * 10) / 10} hours`;
    const logged = await sendLog(interaction, logEmbed("Timeout", user, interaction.user, reason, { duration }), service, delivery);
    logger.info("Member timed out", { guildId: interaction.guildId, targetUserId: user.id, moderatorUserId: interaction.user.id, minutes });
    await interaction.editReply({ content: `**${safe(user.tag, 100)}** was timed out for ${duration}.${logged ? "" : "\n⚠️ The timeout succeeded, but the moderation log could not be delivered."}`,
      allowedMentions: { parse: [] } });
  });
}

export async function untimeout(interaction: ChatInputCommandInteraction, service: ModerationService = moderationService,
  delivery: Delivery = new DiscordWebhookDelivery(interaction.client)) {
  await handle(interaction, async () => {
    const { actor, target, bot, user } = await members(interaction);
    assertTargetHierarchy(actor, target, bot, true);
    if (!target.isCommunicationDisabled()) throw new ModerationError("That member is not currently timed out.");
    const reason = normalizeReason(interaction.options.getString("reason"));
    if (!await service.getConfig(interaction.guildId!)) throw new ModerationError("No moderation log channel is configured. An administrator can set one with /moxie moderation configure.");
    try { await target.timeout(null, `By ${interaction.user.tag} (${interaction.user.id}): ${reason}`.slice(0, 512)); }
    catch { throw new ModerationError("Discord rejected removing the timeout. Check Moxie's permission and role position, then try again."); }
    const logged = await sendLog(interaction, logEmbed("Timeout removed", user, interaction.user, reason), service, delivery);
    logger.info("Member timeout removed", { guildId: interaction.guildId, targetUserId: user.id, moderatorUserId: interaction.user.id });
    await interaction.editReply({ content: `Timeout removed from **${safe(user.tag, 100)}**.${logged ? "" : "\n⚠️ The timeout was removed, but the moderation log could not be delivered."}`,
      allowedMentions: { parse: [] } });
  });
}
