import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ChannelType, PermissionFlagsBits, type Client, type Guild } from "discord.js";
import type { DashboardConfig } from "../core/config";
import { guildConfiguration, type GuildConfiguration } from "../core/database/guildConfiguration";
import { logger } from "../core/logger";
import { DiscordWebhookDelivery } from "../integrations/webhooks/discordDelivery";
import { WebhookError } from "../integrations/webhooks/errors";
import { moderationService, type ModerationService } from "../modules/moderation/service";
import { moduleDefinitions } from "../modules/definitions";
import { DiscordOAuth, DiscordOAuthError, isGuildAdministrator, type OAuthGuild } from "./oauth";

type Session = { userId: string; username: string; accessToken: string; csrf: string; expires: number };
const MAX_SESSIONS = 1000;
const MAX_FORM_BYTES = 4096;

function nonce() { return randomBytes(32).toString("hex"); }
function equal(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function escape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
function cookie(request: IncomingMessage, name: string): string | undefined {
  return request.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
function headers(response: ServerResponse, type: string) {
  response.setHeader("Content-Type", type);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function page(response: ServerResponse, title: string, body: string, status = 200) {
  response.statusCode = status;
  headers(response, "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Moxie</title><link rel="stylesheet" href="/style.css"></head><body><main><header><a class="brand" href="/" aria-label="Moxie dashboard home">✦ Moxie</a><span class="eyebrow">ADMIN DASHBOARD</span></header>${body}</main></body></html>`);
}
function redirect(response: ServerResponse, location: string) {
  response.statusCode = 303;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Location", location);
  response.end();
}
function setCookie(response: ServerResponse, name: string, value: string, maxAge: number, secure: boolean) {
  response.setHeader("Set-Cookie", `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
}
async function form(request: IncomingMessage): Promise<URLSearchParams> {
  if (request.headers["content-type"]?.split(";")[0].trim() !== "application/x-www-form-urlencoded") throw new Error("Invalid form content type");
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_FORM_BYTES) throw new Error("Form too large");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

const style = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e8eaf7;background:#0e1220}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#202b50,#0e1220 60%);min-height:100vh}main{max-width:860px;margin:auto;padding:38px 20px 90px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:56px}.brand{font-weight:800;font-size:1.55rem;letter-spacing:-.04em;color:inherit;text-decoration:none}.brand:hover,.brand:focus-visible{color:#a9b9ff}.eyebrow{font-size:.7rem;font-weight:700;letter-spacing:.18em;color:#9aa9d7}h1{font-size:clamp(2rem,5vw,3.4rem);letter-spacing:-.05em;margin:0 0 12px}h2{font-size:1.2rem;margin:0 0 12px}p{line-height:1.6;color:#adb8d1}a{color:#a9b9ff}a.button,button{display:inline-block;border:0;border-radius:11px;background:#637bfa;color:white;font-weight:700;padding:11px 16px;text-decoration:none;cursor:pointer}button.secondary{background:#2c3653}.card{background:#1a2136;border:1px solid #35415e;border-radius:18px;padding:24px;margin:20px 0;box-shadow:0 20px 55px #0002}.row{display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;border-top:1px solid #35415e;padding:15px 0}.row:first-of-type{border-top:0}.muted{font-size:.85rem;color:#9aa7c4}.badge{border-radius:99px;padding:4px 9px;font-size:.7rem;font-weight:700;background:#34436d;color:#d1dcff}.badge.off{background:#393d4d;color:#b8bfce}select{background:#10172a;color:#e8eaf7;border:1px solid #465576;border-radius:9px;padding:10px;max-width:100%}form.inline{display:inline-flex;align-items:center;gap:10px}nav{margin-bottom:25px}.alert{background:#2d2535;border-left:3px solid #ffba69;padding:13px 16px;border-radius:8px}`;

export class DashboardServer {
  private server?: Server;
  private readonly oauthStates = new Map<string, number>();
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly config: DashboardConfig, private readonly client: Client,
    private readonly oauth: Pick<DiscordOAuth, "authorizationUrl" | "exchange" | "identity" | "guilds"> = new DiscordOAuth(config),
    private readonly configuration: GuildConfiguration = guildConfiguration,
    private readonly moderation: ModerationService = moderationService,
    private readonly destination = new DiscordWebhookDelivery(client)) {}

  private async authorizedGuild(session: Session, guildId: string): Promise<Guild | null> {
    const allowed = (await this.oauth.guilds(session.accessToken)).some(guild => guild.id === guildId && isGuildAdministrator(guild));
    if (!allowed || !this.client.guilds.cache.has(guildId)) return null;
    const guild = await this.client.guilds.fetch(guildId);
    try {
      const member = await guild.members.fetch(session.userId);
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) return null;
      return guild;
    } catch { return null; }
  }

  private session(request: IncomingMessage): Session | undefined {
    const value = cookie(request, "moxie_session");
    const session = value ? this.sessions.get(value) : undefined;
    return session && session.expires > Date.now() ? session : undefined;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, value] of this.oauthStates) if (value <= now) this.oauthStates.delete(key);
    for (const [key, value] of this.sessions) if (value.expires <= now) this.sessions.delete(key);
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try { await this.route(request, response); }
    catch (error) {
      logger.warn("Dashboard request failed", { path: request.url?.split("?")[0] ?? "unknown",
        errorType: error instanceof Error ? error.name : "unknown",
        upstreamStatus: error instanceof DiscordOAuthError ? error.status : null });
      const message = error instanceof WebhookError ? error.message : "Dashboard request failed. Please try again.";
      page(response, "Request failed", `<div class="card"><h1>Request failed</h1><p>${escape(message)}</p><a href="/">Back to dashboard</a></div>`,
        error instanceof WebhookError ? error.status : 503);
    }
  }

  private async route(request: IncomingMessage, response: ServerResponse) {
    this.cleanup();
    const path = new URL(request.url || "/", this.config.baseUrl).pathname;
    const method = request.method ?? "GET";
    if (method === "GET" && path === "/style.css") {
      headers(response, "text/css; charset=utf-8"); response.end(style); return;
    }
    if (method === "GET" && path === "/login") {
      if (this.oauthStates.size >= MAX_SESSIONS) { page(response, "Busy", "<p>Sign-in is busy. Try again shortly.</p>", 503); return; }
      const state = nonce(); this.oauthStates.set(state, Date.now() + 10 * 60_000);
      setCookie(response, "moxie_oauth", state, 600, this.config.baseUrl.protocol === "https:");
      redirect(response, this.oauth.authorizationUrl(state)); return;
    }
    if (method === "GET" && path === "/callback") {
      const url = new URL(request.url || "/", this.config.baseUrl);
      const state = url.searchParams.get("state") ?? "";
      const saved = cookie(request, "moxie_oauth") ?? "";
      const code = url.searchParams.get("code") ?? "";
      if (!equal(state, saved) || !this.oauthStates.has(state) || this.oauthStates.get(state)! <= Date.now() || !code || code.length > 2048) {
        page(response, "Sign-in failed", "<div class=card><h1>Sign-in failed</h1><p>Start a fresh Discord sign-in.</p><a href=/login>Try again</a></div>", 403); return;
      }
      this.oauthStates.delete(state);
      const token = await this.oauth.exchange(code);
      const identity = await this.oauth.identity(token.accessToken);
      if (!/^\d{17,20}$/.test(identity.id)) throw new Error("Invalid identity");
      if (this.sessions.size >= MAX_SESSIONS) { page(response, "Busy", "<p>Dashboard sessions are full. Try again shortly.</p>", 503); return; }
      const sessionId = nonce();
      const life = Math.max(1, Math.min(3600, Math.floor(token.expiresIn) - 30));
      this.sessions.set(sessionId, { userId: identity.id, username: identity.username, accessToken: token.accessToken,
        csrf: nonce(), expires: Date.now() + life * 1000 });
      setCookie(response, "moxie_session", sessionId, life, this.config.baseUrl.protocol === "https:");
      redirect(response, "/"); return;
    }
    const session = this.session(request);
    if (!session) {
      if (method === "GET" && path === "/") page(response, "Sign in", "<div class=card><h1>Manage your server</h1><p>Sign in with Discord to configure servers where you are an administrator.</p><a class=button href=/login>Continue with Discord</a></div>");
      else page(response, "Sign in", "<div class=card><p>Your session expired.</p><a href=/login>Sign in again</a></div>", 401);
      return;
    }
    if (method === "POST") {
      if (request.headers.origin !== this.config.baseUrl.origin) {
        logger.warn("Dashboard form origin rejected", { origin: request.headers.origin ?? "missing", expected: this.config.baseUrl.origin,
          fetchSite: request.headers["sec-fetch-site"] ?? "missing" });
        page(response, "Forbidden", "<p>Invalid request origin.</p>", 403); return;
      }
      const fields = await form(request);
      if (!equal(fields.get("csrf") ?? "", session.csrf)) { page(response, "Forbidden", "<p>Invalid form token.</p>", 403); return; }
      if (path === "/logout") {
        this.sessions.delete(cookie(request, "moxie_session")!);
        setCookie(response, "moxie_session", "", 0, this.config.baseUrl.protocol === "https:");
        redirect(response, "/"); return;
      }
      const match = /^\/guild\/([0-9]{17,20})\/(module|log-channel)$/.exec(path);
      if (!match) { page(response, "Not found", "<p>Page not found.</p>", 404); return; }
      const guild = await this.authorizedGuild(session, match[1]);
      if (!guild) { page(response, "Forbidden", "<p>You cannot administer this server through Moxie.</p>", 403); return; }
      if (match[2] === "module") {
        const name = fields.get("name") ?? "";
        const enabled = fields.get("enabled");
        if (!moduleDefinitions.some(module => module.name === name && !module.required) || !["true", "false"].includes(enabled ?? "")) {
          page(response, "Invalid setting", "<p>Invalid module setting.</p>", 400); return;
        }
        await this.configuration.setEnabled(guild.id, name, enabled === "true");
        logger.info("Dashboard module setting changed", { guildId: guild.id, module: name, enabled: enabled === "true", actorId: session.userId });
      } else {
        const channelId = fields.get("channel") ?? "";
        if (channelId === "remove") await this.moderation.removeConfig(guild.id);
        else {
          if (!/^\d{17,20}$/.test(channelId)) { page(response, "Invalid channel", "<p>Choose a valid channel.</p>", 400); return; }
          await this.destination.validateDestination(guild.id, channelId, true);
          await this.moderation.configure(guild.id, channelId);
        }
        logger.info("Dashboard moderation channel changed", { guildId: guild.id, channelId: channelId === "remove" ? "removed" : channelId, actorId: session.userId });
      }
      redirect(response, `/guild/${guild.id}`); return;
    }
    if (method !== "GET") { page(response, "Method not allowed", "<p>Method not allowed.</p>", 405); return; }
    if (path === "/") {
      const guilds = (await this.oauth.guilds(session.accessToken)).filter(guild => isGuildAdministrator(guild) && this.client.guilds.cache.has(guild.id));
      const cards = guilds.length ? guilds.map((guild: OAuthGuild) => `<div class=card><h2>${escape(guild.name)}</h2><p class=muted>Administrator access</p><a class=button href="/guild/${guild.id}">Manage server</a></div>`).join("") : "<div class=card><p>No shared servers with Administrator access were found.</p></div>";
      page(response, "Your servers", `<h1>Your servers</h1><p>Signed in as ${escape(session.username)}. Choose a server where Moxie is installed.</p>${cards}<form method=post action=/logout><input type=hidden name=csrf value="${session.csrf}"><button class=secondary>Sign out</button></form>`); return;
    }
    const match = /^\/guild\/([0-9]{17,20})$/.exec(path);
    if (!match) { page(response, "Not found", "<p>Page not found.</p>", 404); return; }
    const guild = await this.authorizedGuild(session, match[1]);
    if (!guild) { page(response, "Forbidden", "<p>You cannot administer this server through Moxie.</p>", 403); return; }
    const [modules, moderation] = await Promise.all([this.configuration.listModules(guild.id), this.moderation.getConfig(guild.id)]);
    const member = guild.members.me ?? await guild.members.fetchMe();
    const channels = await guild.channels.fetch();
    const choices = [...channels.values()].filter(channel => channel?.type === ChannelType.GuildText &&
      channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]));
    const moduleRows = modules.map(module => `<div class=row><div><strong>${escape(module.name)}</strong> <span class="badge ${module.enabled ? "" : "off"}">${module.enabled ? "Enabled" : "Disabled"}</span>${module.required ? " <span class=muted>Required</span>" : ""}</div>${module.required ? "" : `<form class=inline method=post action="/guild/${guild.id}/module"><input type=hidden name=csrf value="${session.csrf}"><input type=hidden name=name value="${escape(module.name)}"><input type=hidden name=enabled value="${module.enabled ? "false" : "true"}"><button class=secondary>${module.enabled ? "Disable" : "Enable"}</button></form>`}</div>`).join("");
    const options = choices.map(channel => `<option value="${channel!.id}"${channel!.id === moderation?.logChannelId ? " selected" : ""}>#${escape(channel!.name)}</option>`).join("");
    page(response, guild.name, `<nav><a href=/>← All servers</a></nav><h1>${escape(guild.name)}</h1><p>Changes apply to this server immediately.</p><section class=card><h2>Modules</h2>${moduleRows}</section><section class=card><h2>Moderation log channel</h2><p>Audit cards are sent here. Moxie needs View Channel, Send Messages, and Embed Links.</p><form class=inline method=post action="/guild/${guild.id}/log-channel"><input type=hidden name=csrf value="${session.csrf}"><select name=channel><option value=remove>Not configured</option>${options}</select><button>Save channel</button></form>${moderation && !choices.some(channel => channel?.id === moderation.logChannelId) ? "<p class=alert>The saved channel is unavailable to Moxie. Choose another channel.</p>" : ""}</section>`);
  }

  async start() {
    if (this.server) return;
    const server = createServer((request, response) => { void this.handle(request, response); });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(this.config.port, this.config.host, resolve); });
    this.server = server;
    logger.info("Dashboard listening", { host: this.config.host, port: this.config.port });
  }

  async stop() {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    this.oauthStates.clear();
    this.sessions.clear();
    logger.info("Dashboard stopped");
  }
}
