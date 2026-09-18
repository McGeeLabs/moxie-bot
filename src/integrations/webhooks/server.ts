import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { logger } from "../../core/logger";
import { WebhookError, WebhookService } from "./service";

const MAX_BODY_BYTES = 8192;

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    function cleanup() {
      request.off("data", onData).off("end", onEnd).off("error", onError).off("aborted", onAborted);
    }
    function onData(chunk: Buffer) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        cleanup();
        request.pause();
        reject(new WebhookError(413, "Request body exceeds 8 KiB"));
      } else chunks.push(chunk);
    }
    function onEnd() { cleanup(); resolve(Buffer.concat(chunks)); }
    function onError() { cleanup(); reject(new WebhookError(400, "Could not read request body")); }
    function onAborted() { cleanup(); reject(new WebhookError(400, "Request was aborted")); }
    request.on("data", onData).once("end", onEnd).once("error", onError).once("aborted", onAborted);
  });
}

function respond(response: ServerResponse, status: number, payload: object) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Connection": "close",
    ...(status === 429 ? { "Retry-After": "60" } : {}) });
  response.end(JSON.stringify(payload));
}

export class WebhookServer {
  private server: Server | undefined;
  private startup: Promise<void> | undefined;
  private active = 0;

  constructor(private readonly config: { host: string; port: number }, private readonly service: Pick<WebhookService, "dispatch">) {}

  isListening(): boolean { return this.server?.listening ?? false; }

  async start(): Promise<number> {
    const server = createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 }, (request, response) => {
      request.on("error", () => {});
      response.on("error", () => {});
      void this.handle(request, response).catch(() => {
        logger.warn("Unexpected webhook request failure");
        respond(response, 500, { error: "Webhook request failed" });
      });
    });
    server.setTimeout(20000, socket => socket.destroy());
    server.maxConnections = 32;
    this.server = server;
    this.startup = new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.port, this.config.host, () => { server.off("error", reject); resolve(); });
    });
    await this.startup;
    server.on("error", () => logger.warn("Webhook listener error"));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Webhook listener address is unavailable");
    logger.info("Webhook listener started", { host: this.config.host, port: address.port });
    return address.port;
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const match = /^\/webhooks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(request.url ?? "");
    if (!match) { respond(response, 404, { error: "Not found" }); return; }
    if (request.method !== "POST") { response.setHeader("Allow", "POST"); respond(response, 405, { error: "Use POST" }); return; }
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" ? /^Bearer ([0-9a-f]{64})$/.exec(authorization)?.[1] : undefined;
    if (!token) { respond(response, 401, { error: "A webhook Bearer token is required" }); return; }
    if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json" ||
      (request.headers["content-encoding"] && request.headers["content-encoding"] !== "identity")) {
      respond(response, 415, { error: "Use uncompressed application/json" }); return;
    }
    if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES) { respond(response, 413, { error: "Request body exceeds 8 KiB" }); return; }
    if (this.active >= 8) { respond(response, 429, { error: "Webhook server is busy; retry later" }); return; }
    this.active++;
    try {
      const body = await readBody(request);
      let value: unknown;
      try { value = JSON.parse(body.toString("utf8")); }
      catch { throw new WebhookError(400, "Invalid JSON"); }
      await this.service.dispatch(match[1], token, value);
      respond(response, 200, { status: "delivered" });
    } catch (error) {
      if (error instanceof WebhookError) {
        logger.warn("Webhook request rejected", { routeId: match[1], status: error.status });
        respond(response, error.status, { error: error.message });
      }
      else {
        logger.warn("Webhook request failed", { routeId: match[1] });
        respond(response, 503, { error: "Webhook processing unavailable; check database and Discord connectivity" });
      }
    } finally { this.active--; }
  }

  async stop(): Promise<void> {
    await this.startup?.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => server.closeAllConnections(), 20000);
      timeout.unref();
      server.close(error => { clearTimeout(timeout); if (error) reject(error); else resolve(); });
    });
    logger.info("Webhook listener stopped");
  }
}

let listener: WebhookServer | undefined;
export function getWebhookListenerStatus(): boolean { return listener?.isListening() ?? false; }
export async function startWebhookListener(config: { host: string; port: number } | undefined, service: WebhookService) {
  if (!config) { logger.info("Webhook listener disabled"); return; }
  listener = new WebhookServer(config, service);
  await listener.start();
}
export async function stopWebhookListener() {
  await listener?.stop();
  listener = undefined;
}
