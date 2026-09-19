import { ChannelType, MessageFlags, PermissionFlagsBits, type Client, type APIEmbed } from "discord.js";
import { WebhookError, type WebhookDelivery } from "./service";

export class DiscordWebhookDelivery implements WebhookDelivery {
  constructor(private readonly client: Client) {}

  private async destination(guildId: string, channelId: string, needsEmbeds = false) {
    if (!this.client.isReady()) throw new WebhookError(503, "Discord is not ready; retry later");
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel || channel.guildId !== guildId || channel.type !== ChannelType.GuildText) {
        throw new WebhookError(400, "Destination must be a text channel in this server");
      }
      const member = guild.members.me ?? await guild.members.fetchMe();
      if (!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        throw new WebhookError(403, "Moxie needs View Channel and Send Messages in the destination");
      }
      if (needsEmbeds && !channel.permissionsFor(member)?.has(PermissionFlagsBits.EmbedLinks)) {
        throw new WebhookError(403, "Moxie needs Embed Links in the destination for notification cards");
      }
      return channel;
    } catch (error) {
      if (error instanceof WebhookError) throw error;
      throw new WebhookError(503, "Discord destination is unavailable; check guild membership and channel permissions");
    }
  }

  async validateDestination(guildId: string, channelId: string, needsEmbeds = false): Promise<void> {
    await this.destination(guildId, channelId, needsEmbeds);
  }

  async send(guildId: string, channelId: string, content: string, embed?: APIEmbed): Promise<void> {
    const channel = await this.destination(guildId, channelId, Boolean(embed));
    try {
      await channel.send({
        ...(embed ? { embeds: [embed] } : { content, flags: MessageFlags.SuppressEmbeds }),
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch {
      throw new WebhookError(502, "Discord delivery failed; retrying may duplicate a notification");
    }
  }
}
