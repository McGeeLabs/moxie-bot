import { WebhookError } from "../webhooks/errors";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
    .replace(/([\\`*_~|<>])/g, "\\$1");
}

function details(value: string): string {
  // Render notification text, never the full monitor configuration.
  const sanitized = value.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/https?:\/\/[^\s<>]+/gi, match => {
    try {
      const url = new URL(match);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch { return "[URL omitted]"; }
  });
  return text(sanitized, 1000);
}

export function formatUptimeKumaEvent(value: unknown): { content: string } {
  const invalid = () => new WebhookError(400, "Expected Uptime Kuma JSON with msg, monitor, and heartbeat; heartbeat status must be 0–3");
  if (!object(value) || Object.keys(value).some(key => !["msg", "monitor", "heartbeat"].includes(key)) ||
    typeof value.msg !== "string" || !value.msg.trim()) throw invalid();
  const monitor = value.monitor;
  const heartbeat = value.heartbeat;
  if (monitor != null && !object(monitor)) throw invalid();
  if (heartbeat == null) {
    return { content: `Uptime Kuma — Notification\n${details(value.msg)}`.slice(0, 1900) };
  }
  if (!object(heartbeat) || !object(monitor) || typeof monitor.name !== "string" || !monitor.name.trim() ||
    typeof heartbeat.status !== "number" || !Number.isInteger(heartbeat.status) || heartbeat.status < 0 || heartbeat.status > 3) throw invalid();
  if (heartbeat.ping != null && (typeof heartbeat.ping !== "number" || !Number.isFinite(heartbeat.ping) || heartbeat.ping < 0)) throw invalid();
  if (heartbeat.time != null && (typeof heartbeat.time !== "string" || heartbeat.time.length > 100)) throw invalid();
  if (heartbeat.msg != null && typeof heartbeat.msg !== "string") throw invalid();
  const lines = [
    `Uptime Kuma — ${["DOWN", "UP", "PENDING", "MAINTENANCE"][heartbeat.status]}`,
    `Monitor: ${text(monitor.name, 160)}`,
  ];
  if (heartbeat.ping != null) lines.push(`Latency: ${heartbeat.ping}ms`);
  if (heartbeat.time) lines.push(`Reported time: ${text(heartbeat.time, 100)}`);
  lines.push(`Details: ${details(heartbeat.msg || value.msg)}`);
  return { content: lines.join("\n").slice(0, 1900) };
}
