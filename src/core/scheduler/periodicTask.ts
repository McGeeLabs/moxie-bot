import { logger } from "../logger";

export class PeriodicTask {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopped = false;
  private lastRunAt?: Date;
  private lastSuccessAt?: Date;
  private errors = 0;

  constructor(private readonly name: string, private readonly action: () => Promise<void>, readonly intervalMs = 60000) {
    if (!Number.isInteger(intervalMs) || intervalMs < 50) throw new Error("Invalid scheduler interval");
  }

  get status() {
    return { running: Boolean(this.timer), inProgress: Boolean(this.active), intervalMs: this.intervalMs,
      lastRunAt: this.lastRunAt, lastSuccessAt: this.lastSuccessAt, errors: this.errors };
  }

  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs);
    this.timer.unref();
    void this.runOnce();
  }

  runOnce(): Promise<void> {
    if (this.active) return this.active;
    if (this.stopped) return Promise.resolve();
    this.lastRunAt = new Date();
    this.active = Promise.resolve().then(this.action).then(() => { this.lastSuccessAt = new Date(); })
      .catch(() => { this.errors++; logger.warn("Scheduled task failed", { task: this.name }); })
      .finally(() => { this.active = undefined; });
    return this.active;
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }
}
