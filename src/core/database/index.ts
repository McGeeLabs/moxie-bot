import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { logger } from "../logger";

export type DatabaseHealth =
  | { status: "not_configured" }
  | { status: "connected"; latencyMs: number }
  | { status: "unavailable" };

let database: PrismaClient | undefined;

export function getDatabase(): PrismaClient | undefined {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return undefined;
  if (!database) {
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
    }
    const adapter = new PrismaPg({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      // Bound server-side execution as well as connection establishment.
      options: "-c statement_timeout=3000",
    });
    database = new PrismaClient({ adapter });
  }
  return database;
}

export async function checkDatabase(): Promise<DatabaseHealth> {
  if (!process.env.DATABASE_URL?.trim()) return { status: "not_configured" };
  const started = Date.now();
  try {
    await getDatabase()!.$queryRaw`SELECT 1`;
    return { status: "connected", latencyMs: Date.now() - started };
  } catch {
    // Driver errors can contain credentials; don't log the raw error or URL.
    logger.warn("Database health check failed; verify credentials and connectivity");
    return { status: "unavailable" };
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (database) {
    await database.$disconnect();
    database = undefined;
  }
}
