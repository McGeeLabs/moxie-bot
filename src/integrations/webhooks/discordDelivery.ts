import { ChannelType, MessageFlags, PermissionFlagsBits, type Client } from "discord.js";
import { WebhookError, type WebhookDelivery } from "./service";

export class DiscordWebhookDelivery implements WebhookDelivery {
  constructor(private readonly client: Client) {}

  private async destination(guildId: string, channelId: string) {
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
      return channel;
    } catch (error) {
      if (error instanceof WebhookError) throw error;
      throw new WebhookError(503, "Discord destination is unavailable; check guild membership and channel permissions");
    }
  }

  async validateDestination(guildId: string, channelId: string): Promise<void> {
    await this.destination(guildId, channelId);
  }

  async send(guildId: string, channelId: string, content: string): Promise<void> {
    const channel = await this.destination(guildId, channelId);
    try {
      await channel.send({ content, allowedMentions: { parse: [], repliedUser: false }, flags: MessageFlags.SuppressEmbeds });
    } catch {
      throw new WebhookError(502, "Discord delivery failed; retrying may duplicate a notification");
    }
  }
}
