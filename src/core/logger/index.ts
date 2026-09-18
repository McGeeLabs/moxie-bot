type Context = Record<string, string | number | boolean | null>;

function write(level: "info" | "warn" | "error", message: string, context: Context = {}, error?: unknown) {
  // Only log explicit metadata, never entire config, interactions, or REST requests.
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(), level, message, ...context,
    ...(error === undefined ? {} : { error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: "Non-Error value thrown" } }),
  });
  const token = process.env.DISCORD_TOKEN?.trim();
  const safeEntry = (token ? entry.split(token).join("[REDACTED]") : entry)
    .replace(/Bearer [0-9a-f]{64}/gi, "Bearer [REDACTED]");
  if (level === "error") console.error(safeEntry);
  else if (level === "warn") console.warn(safeEntry);
  else console.log(safeEntry);
}

export const logger = {
  info: (message: string, context?: Context) => write("info", message, context),
  warn: (message: string, context?: Context) => write("warn", message, context),
  error: (message: string, error: unknown, context?: Context) => write("error", message, context, error),
};
