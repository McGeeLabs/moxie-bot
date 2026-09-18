import { checkDatabase, disconnectDatabase } from "./index";
import { logger } from "../logger";

async function main() {
  try {
    const health = await checkDatabase();
    if (health.status === "connected") logger.info("PostgreSQL connection verified", { latencyMs: health.latencyMs });
    else {
      logger.warn(health.status === "not_configured" ? "DATABASE_URL is not configured" : "PostgreSQL is unavailable");
      process.exitCode = 1;
    }
  } finally {
    await disconnectDatabase();
  }
}

void main().catch(() => {
  logger.warn("Database check failed");
  process.exitCode = 1;
});
