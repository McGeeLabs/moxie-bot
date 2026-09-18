import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { APIEmbed } from "discord.js";
import type { PrismaClient } from "../../generated/prisma/client";
import { getDatabase } from "../../core/database";
import { guildConfiguration, type GuildConfiguration } from "../../core/database/guildConfiguration";
import { logger } from "../../core/logger";
import { WebhookError } from "./errors";
import { webhookProviders, type WebhookProvider } from "./providers";
import { formatUptimeKumaEvent } from "../uptimeKuma/formatter";
export { WebhookError } from "./errors";

export type WebhookEvent = { content: string; embed?: APIEmbed };
export type RouteSummary = { id: string; name: string; channelId: string; provider: WebhookProvider };
export interface WebhookDelivery {
  validateDestination(guildId: string, channelId: string): Promise<void>;
  send(guildId: string, channelId: string, content: string, embed?: APIEmbed): Promise<void>;
}

type WebhookDatabase = Pick<PrismaClient, "webhookRoute">;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newSecret = () => randomBytes(32).toString("hex");

export function validateEvent(value: unknown): WebhookEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WebhookError(400, "Expected a JSON object with content");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "content") || typeof record.content !== "string" || !record.content.trim() || record.content.length > 1900) {
    throw new WebhookError(400, "Only content is accepted: a non-empty string of at most 1900 characters");
  }
  return { content: record.content };
}

export class WebhookService {
  private readonly windows = new Map<string, { count: number; expires: number }>();

  constructor(
    private readonly delivery: WebhookDelivery,
    private readonly databaseProvider: () => WebhookDatabase | undefined = getDatabase,
    private readonly configuration: Pick<GuildConfiguration, "ensureGuild" | "isEnabled"> = guildConfiguration,
    private readonly now: () => number = Date.now,
  ) {}

  private async query<T>(action: (database: WebhookDatabase) => Promise<T>): Promise<T> {
    try {
      const database = this.databaseProvider();
      if (!database) throw new Error("Missing database");
      return await action(database);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new WebhookError(409, "A webhook with this name already exists in this server");
      }
      logger.warn("Webhook storage operation failed");
      throw new WebhookError(503, "Webhook storage is unavailable; check the database connection and migrations");
    }
  }

  async createRoute(guildId: string, name: string, channelId: string, provider: WebhookProvider = "generic") {
    if (!webhookProviders.some(item => item.value === provider)) throw new WebhookError(400, "Unsupported webhook provider");
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(name)) throw new WebhookError(400, "Names must use 1–40 lowercase letters, digits, underscores, or hyphens");
    await this.delivery.validateDestination(guildId, channelId);
    await this.configuration.ensureGuild(guildId);
    const token = newSecret();
    const route = await this.query(database => database.webhookRoute.create({
      data: { guildId, name, channelId, provider, secretHash: hash(token) },
      select: { id: true, name: true, channelId: true, provider: true },
    }));
    return { ...route, token };
  }

  async listRoutes(guildId: string): Promise<RouteSummary[]> {
    return this.query(database => database.webhookRoute.findMany({
      where: { guildId }, orderBy: { createdAt: "asc" }, take: 10,
      select: { id: true, name: true, channelId: true, provider: true },
    }));
  }

  async rotateSecret(guildId: string, name: string) {
    const token = newSecret();
    const route = await this.query(database => database.webhookRoute.updateMany({
      where: { guildId, name }, data: { secretHash: hash(token) },
    }));
    if (!route.count) throw new WebhookError(404, "No webhook with this name exists in this server");
    const summary = await this.query(database => database.webhookRoute.findUnique({
      where: { guildId_name: { guildId, name } }, select: { id: true, name: true, channelId: true, provider: true },
    }));
    if (!summary) throw new WebhookError(404, "Webhook was deleted during rotation");
    return { ...summary, token };
  }

  async deleteRoute(guildId: string, name: string): Promise<void> {
    const result = await this.query(database => database.webhookRoute.deleteMany({ where: { guildId, name } }));
    if (!result.count) throw new WebhookError(404, "No webhook with this name exists in this server");
  }

  async dispatch(routeId: string, token: string, event: unknown): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(token)) throw new WebhookError(401, "Invalid webhook credentials");
    const route = await this.query(database => database.webhookRoute.findUnique({ where: { id: routeId } }));
    if (!route) throw new WebhookError(404, "Webhook not found");
    const supplied = Buffer.from(hash(token), "hex");
    const expected = Buffer.from(route.secretHash, "hex");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new WebhookError(401, "Invalid webhook credentials");
    if (!await this.configuration.isEnabled(route.guildId, "webhooks")) throw new WebhookError(403, "Webhooks are disabled in this server");
    if (route.provider === "uptimeKuma" && !await this.configuration.isEnabled(route.guildId, "uptimeKuma")) {
      throw new WebhookError(403, "Uptime Kuma is disabled in this server");
    }
    const validated: WebhookEvent = route.provider === "uptimeKuma" ? formatUptimeKumaEvent(event) : validateEvent(event);
    const timestamp = this.now();
    for (const [id, window] of this.windows) if (window.expires <= timestamp) this.windows.delete(id);
    let window = this.windows.get(routeId);
    if (!window) {
      if (this.windows.size >= 1000) throw new WebhookError(429, "Too many active webhook routes; retry later");
      window = { count: 0, expires: timestamp + 60000 };
      this.windows.set(routeId, window);
    }
    if (++window.count > 60) throw new WebhookError(429, "Webhook rate limit exceeded; retry after 60 seconds");
    const content = `[${route.name}] ${validated.content}`;
    if (validated.embed) {
      await this.delivery.send(route.guildId, route.channelId, content, {
        ...validated.embed, footer: { text: `Moxie • Uptime Kuma • ${route.name}` },
      });
    } else {
      await this.delivery.send(route.guildId, route.channelId, content);
    }
    logger.info("Webhook notification delivered", { routeId, guildId: route.guildId, channelId: route.channelId, provider: route.provider });
  }
}
