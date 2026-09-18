import type { PrismaClient, ValheimServerConfig } from "../../generated/prisma/client";
import { getDatabase } from "../../core/database";
import { guildConfiguration, type GuildConfiguration } from "../../core/database/guildConfiguration";
import { PeriodicTask } from "../../core/scheduler/periodicTask";
import { logger } from "../../core/logger";
import { queryValheim } from "../../integrations/valheim/query";
import type { WebhookDelivery } from "../../integrations/webhooks/service";
import { statusEmbed } from "./commands";

type Database = Pick<PrismaClient, "valheimServerConfig">;
type State = "online" | "unavailable" | null;

export function nextMonitorState(status: State, failures: number, online: boolean) {
  const consecutiveFailures = online ? 0 : Math.min(failures + 1, 3);
  return { monitorStatus: online ? "online" as const : consecutiveFailures >= 3 ? "unavailable" as const : status, consecutiveFailures };
}

export class ValheimMonitor {
  private readonly task: PeriodicTask;
  private stopped = false;
  private checked = 0;
  private unavailable = 0;
  private deliveryErrors = 0;

  constructor(private readonly delivery: WebhookDelivery,
    private readonly databaseProvider: () => Database | undefined = getDatabase,
    private readonly configuration: Pick<GuildConfiguration, "isEnabled"> = guildConfiguration,
    private readonly query = queryValheim,
    private readonly canCheck: (guildId: string) => boolean = () => true,
    private readonly eligibleGuilds?: () => string[]) {
    this.task = new PeriodicTask("Valheim", () => this.cycle());
  }

  get status() { return { ...this.task.status, checkedLastCycle: this.checked, unavailableLastCycle: this.unavailable, deliveryErrors: this.deliveryErrors }; }
  start() { this.stopped = false; this.task.start(); }
  runOnce() { return this.task.runOnce(); }
  async stop() { this.stopped = true; await this.task.stop(); }

  private async cycle() {
    this.checked = 0;
    this.unavailable = 0;
    const database = this.databaseProvider();
    if (!database) throw new Error("Missing database");
    const rows = await database.valheimServerConfig.findMany({
      where: { ...(this.eligibleGuilds ? { guildId: { in: this.eligibleGuilds() } } : {}),
        guild: { modules: { some: { module: "valheim", enabled: true } } } },
      orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { guildId: "asc" }], take: 100,
    });
    let index = 0;
    const worker = async () => {
      while (!this.stopped && index < rows.length) {
        const row = rows[index++];
        if (!this.canCheck(row.guildId)) continue;
        try { await this.check(database, row); }
        catch { logger.warn("Valheim scheduled check failed", { guildId: row.guildId }); throw new Error("Scheduled check failed"); }
      }
    };
    // Wait for every worker, including after an error, before allowing another cycle.
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, rows.length) }, worker));
    if (results.some(result => result.status === "rejected")) throw new Error("Some scheduled checks failed");
  }

  private async check(database: Database, row: ValheimServerConfig) {
    if (!await this.configuration.isEnabled(row.guildId, "valheim") || this.stopped) return;
    const result = await this.query(row.host, row.queryPort);
    if (this.stopped || !this.canCheck(row.guildId)) return;
    this.checked++;
    if (result.status !== "online") this.unavailable++;
    const next = nextMonitorState(row.monitorStatus, row.consecutiveFailures, result.status === "online");
    const lastCheckedAt = new Date();
    const updated = await database.valheimServerConfig.updateMany({
      where: { guildId: row.guildId, updatedAt: row.updatedAt },
      data: { ...next, lastCheckedAt, ...(row.monitorStatus === null && next.monitorStatus !== null ? { lastNotifiedStatus: next.monitorStatus } : {}) },
    });
    if (!updated.count || next.monitorStatus === null || row.monitorStatus === null || this.stopped) return;
    // Do not announce recovery until a successful query; retained online state
    // during failure debounce is not evidence of recovery.
    if (next.monitorStatus === row.lastNotifiedStatus || next.monitorStatus !== result.status) return;
    if (!await this.configuration.isEnabled(row.guildId, "valheim") || !this.canCheck(row.guildId) || this.stopped) return;
    const current = await database.valheimServerConfig.findUnique({ where: { guildId: row.guildId } });
    if (!current || current.lastCheckedAt?.getTime() !== lastCheckedAt.getTime() || current.monitorStatus !== next.monitorStatus) return;
    const embed = statusEmbed(row, result);
    embed.title = next.monitorStatus === "online" ? "Valheim • Connection restored" : "Valheim • Query unavailable";
    if (next.monitorStatus === "unavailable") embed.description = `Three consecutive scheduled queries failed.\n\n${embed.description}`;
    embed.footer = { text: "Moxie • Valheim monitoring • Scheduled every 60 seconds" };
    try { await this.delivery.send(row.guildId, row.channelId, "Valheim monitoring update", embed); }
    catch { this.deliveryErrors++; logger.warn("Valheim alert delivery failed; will retry on a later check", { guildId: row.guildId }); return; }
    await database.valheimServerConfig.updateMany({
      where: { guildId: row.guildId, host: row.host, gamePort: row.gamePort, queryPort: row.queryPort, channelId: row.channelId,
        monitorStatus: next.monitorStatus, lastNotifiedStatus: row.lastNotifiedStatus },
      data: { lastNotifiedStatus: next.monitorStatus },
    });
    logger.info("Valheim monitoring transition delivered", { guildId: row.guildId, status: next.monitorStatus });
  }
}
