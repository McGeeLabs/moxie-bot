import { MessageFlags, PermissionFlagsBits, escapeMarkdown, type APIEmbed, type ChatInputCommandInteraction, type PermissionResolvable, type User } from "discord.js";
import { ConfigurationUnavailableError } from "../../core/database/guildConfiguration";
import { logger } from "../../core/logger";
import { DiscordWebhookDelivery } from "../../integrations/webhooks/discordDelivery";
import { WebhookError } from "../../integrations/webhooks/errors";
import { assertTargetHierarchy, requirePermission, type DiscordModerationAction } from "./permissions";
import { moderationService, ModerationError, normalizeReason, type ModerationAction, type ModerationCase, type ModerationService } from "./service";

type Delivery = Pick<DiscordWebhookDelivery, "send">;
const labels: Record<ModerationAction, string> = { warn: "Warning", timeout: "Timeout", untimeout: "Timeout removed", kick: "Kick", ban: "Ban" };
const colors: Record<ModerationAction, number> = { warn: 0xf59e0b, timeout: 0xef4444, untimeout: 0x22c55e, kick: 0xf97316, ban: 0x991b1b };

function safe(value: string, limit = 500): string {
  return escapeMarkdown(value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit)) || "Not provided";
}

function caseId(interaction: ChatInputCommandInteraction): string {
  const id = interaction.options.getString("id", true).trim();
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new ModerationError("Enter a valid moderation case ID.");
  return id;
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
  } catch { throw new ModerationError("That member is no longer available in this server."); }
}

async function enforceExistingTargetHierarchy(interaction: ChatInputCommandInteraction, targetUserId: string) {
  const guild = interaction.guild;
  if (!guild) throw new ModerationError("This command is available in servers only.");
  const [actor, bot] = await Promise.all([guild.members.fetch(interaction.user.id), guild.members.fetchMe()]);
  try {
    const target = await guild.members.fetch(targetUserId);
    assertTargetHierarchy(actor, target, bot, "none");
  } catch (error) {
    if (error instanceof ModerationError) throw error;
    // Historical cases remain editable after a member leaves the guild.
  }
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  return `${Math.round(minutes / 60 * 10) / 10} hours`;
}

function logEmbed(record: ModerationCase, target: User, moderator: User): APIEmbed {
  return { title: `Moderation • ${labels[record.action]}`, color: colors[record.action], fields: [
    { name: "Member", value: `${safe(target.tag, 100)}\n\`${target.id}\``, inline: true },
    { name: "Moderator", value: `${safe(moderator.tag, 100)}\n\`${moderator.id}\``, inline: true },
    ...(record.durationMinutes ? [{ name: "Duration", value: duration(record.durationMinutes), inline: true }] : []),
    { name: "Reason", value: safe(record.reason), inline: false },
    { name: "Case ID", value: `\`${record.id}\``, inline: false },
  ], timestamp: record.createdAt.toISOString(), footer: { text: "Moxie • Moderation" } };
}

function caseEmbed(record: ModerationCase): APIEmbed {
  return { title: `Moderation case • ${labels[record.action]}`, color: colors[record.action], fields: [
    { name: "Member", value: `<@${record.targetUserId}>\n\`${record.targetUserId}\``, inline: true },
    { name: "Moderator", value: `<@${record.moderatorUserId}>\n\`${record.moderatorUserId}\``, inline: true },
    ...(record.durationMinutes ? [{ name: "Duration", value: duration(record.durationMinutes), inline: true }] : []),
    { name: "Reason", value: safe(record.reason), inline: false },
    { name: "Created", value: `<t:${Math.floor(record.createdAt.getTime() / 1000)}:F>`, inline: false },
    ...(record.reasonUpdatedAt && record.reasonUpdatedById ? [{ name: "Reason corrected", value: `<t:${Math.floor(record.reasonUpdatedAt.getTime() / 1000)}:F> by <@${record.reasonUpdatedById}>`, inline: false }] : []),
    { name: "Case ID", value: `\`${record.id}\``, inline: false },
  ], footer: { text: "Moxie • Moderation" } };
}

async function sendLog(interaction: ChatInputCommandInteraction, embed: APIEmbed, service: ModerationService, delivery: Delivery): Promise<boolean> {
  const config = await service.getConfig(interaction.guildId!);
  if (!config) return false;
  try { await delivery.send(interaction.guildId!, config.logChannelId, "Moderation action", embed); return true; }
  catch (error) {
    if (!(error instanceof WebhookError)) throw error;
    logger.warn("Moderation log delivery failed", { guildId: interaction.guildId, action: embed.title ?? "unknown" });
    return false;
  }
}

async function handle(interaction: ChatInputCommandInteraction, permission: PermissionResolvable, label: string, action: () => Promise<void>) {
  if (!await requirePermission(interaction, permission, label)) return;
  if (!interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try { await action(); }
  catch (error) {
    if (error instanceof ModerationError) await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } });
    else throw error;
  }
}

async function recordAfterAction(service: ModerationService, guildId: string, targetId: string, moderatorId: string,
  action: ModerationAction, reason: string, durationMinutes?: number) {
  try { return await service.createCase(guildId, targetId, moderatorId, action, reason, durationMinutes); }
  catch (error) {
    if (error instanceof ConfigurationUnavailableError) {
      throw new ModerationError("The Discord action succeeded, but Moxie could not save its case. Check the database before taking another action.");
    }
    throw error;
  }
}

async function actionConfirmation(interaction: ChatInputCommandInteraction, record: ModerationCase, user: User,
  service: ModerationService, delivery: Delivery, text: string) {
  const logged = await sendLog(interaction, logEmbed(record, user, interaction.user), service, delivery);
  await interaction.editReply({ content: `${text} Case ID: \`${record.id}\`${logged ? "" : "\n⚠️ The case was saved, but the moderation log could not be delivered."}`,
    allowedMentions: { parse: [] } });
}

export async function warn(interaction: ChatInputCommandInteraction, service = moderationService,
  delivery: Delivery = new DiscordWebhookDelivery(interaction.client)) {
  await handle(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members", async () => {
    const { actor, target, bot, user } = await members(interaction);
    assertTargetHierarchy(actor, target, bot, "none");
    const record = await service.createCase(interaction.guildId!, user.id, interaction.user.id, "warn", interaction.options.getString("reason", true));
    logger.info("Moderation case recorded", { guildId: interaction.guildId, action: record.action, targetUserId: user.id, moderatorUserId: interaction.user.id, caseId: record.id });
    await actionConfirmation(interaction, record, user, service, delivery, `Warning recorded for **${safe(user.tag, 100)}**.`);
  });
}

async function history(interaction: ChatInputCommandInteraction, warningsOnly: boolean, service: ModerationService) {
  const user = interaction.options.getUser("member", true);
  await enforceExistingTargetHierarchy(interaction, user.id);
  const result = warningsOnly ? await service.warnings(interaction.guildId!, user.id) : await service.cases(interaction.guildId!, user.id);
  const description = result.records.length ? result.records.map(record =>
    `**${labels[record.action]}** • ${safe(record.reason, 180)}\n<t:${Math.floor(record.createdAt.getTime() / 1000)}:f> by <@${record.moderatorUserId}> • \`${record.id}\``).join("\n\n") : `No ${warningsOnly ? "warnings" : "moderation cases"} recorded.`;
  await interaction.editReply({ embeds: [{ title: `${warningsOnly ? "Warnings" : "Moderation cases"} • ${safe(user.tag, 100)}`, description,
    color: warningsOnly ? colors.warn : 0x3b82f6, footer: { text: `${result.total} total • Showing newest ${result.records.length}` } }], allowedMentions: { parse: [] } });
}

export async function listWarnings(interaction: ChatInputCommandInteraction, service = moderationService) {
  await handle(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members", () => history(interaction, true, service));
}

export async function listCases(interaction: ChatInputCommandInteraction, service = moderationService) {
  await handle(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members", () => history(interaction, false, service));
}

export async function showCase(interaction: ChatInputCommandInteraction, service = moderationService) {
  await handle(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members", async () => {
    const record = await service.getCase(interaction.guildId!, caseId(interaction));
    if (!record) throw new ModerationError("No moderation case with that ID exists in this server.");
    await enforceExistingTargetHierarchy(interaction, record.targetUserId);
    await interaction.editReply({ embeds: [caseEmbed(record)], allowedMentions: { parse: [] } });
  });
}

export async function editReason(interaction: ChatInputCommandInteraction, service = moderationService,
  delivery: Delivery = new DiscordWebhookDelivery(interaction.client)) {
  await handle(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members", async () => {
    const id = caseId(interaction);
    await service.requireConfig(interaction.guildId!);
    const previous = await service.getCase(interaction.guildId!, id);
    if (!previous) throw new ModerationError("No moderation case with that ID exists in this server.");
    const previousReason = previous.reason;
    await enforceExistingTargetHierarchy(interaction, previous.targetUserId);
    const record = await service.updateReason(interaction.guildId!, id, interaction.options.getString("reason", true), interaction.user.id);
    const embed = caseEmbed(record); embed.title = "Moderation • Reason corrected"; embed.color = 0x3b82f6;
    embed.fields?.splice(3, 0, { name: "Previous reason", value: safe(previousReason), inline: false });
    const logged = await sendLog(interaction, embed, service, delivery);
    logger.info("Moderation case reason corrected", { guildId: interaction.guildId, caseId: id, actorId: interaction.user.id });
    await interaction.editReply({ content: `Reason updated for case \`${id}\`.${logged ? "" : "\n⚠️ The correction was saved, but the moderation log could not be delivered."}`,
      allowedMentions: { parse: [] } });
  });
}

async function discordAction(interaction: ChatInputCommandInteraction, action: Exclude<DiscordModerationAction, "none">,
  service: ModerationService, delivery: Delivery) {
  const { actor, target, bot, user } = await members(interaction);
  assertTargetHierarchy(actor, target, bot, action);
  const reason = normalizeReason(interaction.options.getString("reason"));
  await service.requireConfig(interaction.guildId!);
  let durationMinutes: number | undefined;
  try {
    if (action === "timeout") {
      const minutes = interaction.options.getInteger("minutes", true);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 40320) throw new ModerationError("Timeout duration must be from 1 to 40,320 minutes (28 days).");
      durationMinutes = minutes;
      await target.timeout(minutes * 60_000, `By ${interaction.user.tag} (${interaction.user.id}): ${reason}`.slice(0, 512));
    } else if (action === "kick") await target.kick(`By ${interaction.user.tag} (${interaction.user.id}): ${reason}`.slice(0, 512));
    else await target.ban({ reason: `By ${interaction.user.tag} (${interaction.user.id}): ${reason}`.slice(0, 512) });
  } catch (error) {
    if (error instanceof ModerationError) throw error;
    throw new ModerationError(`Discord rejected the ${action}. Check Moxie's permission and role position, then try again.`);
  }
  const record = await recordAfterAction(service, interaction.guildId!, user.id, interaction.user.id, action, reason, durationMinutes);
  logger.info("Discord moderation action completed", { guildId: interaction.guildId, action, targetUserId: user.id, moderatorUserId: interaction.user.id, caseId: record.id });
  const result = action === "timeout" ? `**${safe(user.tag, 100)}** was timed out for ${duration(durationMinutes!)}.` :
    `**${safe(user.tag, 100)}** was ${action === "kick" ? "kicked" : "banned"}.`;
  await actionConfirmation(interaction, record, user, service, delivery, result);
}

export async function timeout(interaction: ChatInputCommandInteraction, service = moderationService,
  delivery: Delivery = new DiscordWebhookDelivery(interaction.client)) {
  await handle(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members", () => discordAction(interaction, "timeout", service, delivery));
}

export async function untimeout(interaction: ChatInputCommandInteraction, service = moderationService,
  delivery: Delivery = new DiscordWebhookDelivery(interaction.client)) {
  await handle(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members", async () => {
    const { actor, target, bot, user } = await members(interaction);
    assertTargetHierarchy(actor, target, bot, "timeout");
    if (!target.isCommunicationDisabled()) throw new ModerationError("That member is not currently timed out.");
    const reason = normalizeReason(interaction.options.getString("reason"));
    await service.requireConfig(interaction.guildId!);
    try { await target.timeout(null, `By ${interaction.user.tag} (${interaction.user.id}): ${reason}`.slice(0, 512)); }
    catch { throw new ModerationError("Discord rejected removing the timeout. Check Moxie's permission and role position, then try again."); }
    const record = await recordAfterAction(service, interaction.guildId!, user.id, interaction.user.id, "untimeout", reason);
    logger.info("Discord moderation action completed", { guildId: interaction.guildId, action: "untimeout", targetUserId: user.id, moderatorUserId: interaction.user.id, caseId: record.id });
    await actionConfirmation(interaction, record, user, service, delivery, `Timeout removed from **${safe(user.tag, 100)}**.`);
  });
}

export async function kick(interaction: ChatInputCommandInteraction, service = moderationService,
  delivery: Delivery = new DiscordWebhookDelivery(interaction.client)) {
  await handle(interaction, PermissionFlagsBits.KickMembers, "Kick Members", () => discordAction(interaction, "kick", service, delivery));
}

export async function ban(interaction: ChatInputCommandInteraction, service = moderationService,
  delivery: Delivery = new DiscordWebhookDelivery(interaction.client)) {
  await handle(interaction, PermissionFlagsBits.BanMembers, "Ban Members", () => discordAction(interaction, "ban", service, delivery));
}
