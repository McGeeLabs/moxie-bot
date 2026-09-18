import { createClient } from "./core/client";
import { readRuntimeConfig, readWebhookConfig } from "./core/config";
import { logger } from "./core/logger";
import { checkDatabase, disconnectDatabase } from "./core/database";
import { startWebhookListener, stopWebhookListener } from "./integrations/webhooks/server";

let stopping = false;
const client = createClient();

async function shutdown(reason: string, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  logger.info("Stopping Moxie", { reason });
  try {
    await stopWebhookListener();
  } catch {
    logger.warn("Webhook listener shutdown failed");
    process.exitCode = 1;
  }
  try {
    await client.destroy();
  } catch (error) {
    logger.error("Shutdown failed", error);
    process.exitCode = 1;
  }
  try {
    await disconnectDatabase();
  } catch {
    logger.warn("Database disconnect failed");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

async function main() {
  const config = readRuntimeConfig();
  const webhooks = readWebhookConfig();
  const health = await checkDatabase();
  logger.info("Database startup check", { status: health.status });
  if (stopping) return;
  await client.login(config.token);
  if (!stopping) await startWebhookListener(webhooks, client.webhooks);
}

void main().catch(async error => {
  logger.error("Moxie startup failed", error);
  await shutdown("startup failure", 1);
});
