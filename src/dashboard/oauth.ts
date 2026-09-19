import { PermissionFlagsBits } from "discord.js";
import type { DashboardConfig } from "../core/config";

export type OAuthGuild = { id: string; name: string; owner: boolean; permissions: string };
export type OAuthIdentity = { id: string; username: string };
export type OAuthToken = { accessToken: string; expiresIn: number };

export function isGuildAdministrator(guild: OAuthGuild): boolean {
  try { return guild.owner || (BigInt(guild.permissions) & PermissionFlagsBits.Administrator) !== 0n; }
  catch { return false; }
}

export class DiscordOAuth {
  constructor(private readonly config: DashboardConfig, private readonly request: typeof fetch = fetch) {}

  authorizationUrl(state: string): string {
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({ response_type: "code", client_id: this.config.clientId,
      redirect_uri: new URL("/callback", this.config.baseUrl).toString(), scope: "identify guilds", state }).toString();
    return url.toString();
  }

  async exchange(code: string): Promise<OAuthToken> {
    const body = new URLSearchParams({ grant_type: "authorization_code", code,
      redirect_uri: new URL("/callback", this.config.baseUrl).toString(), client_id: this.config.clientId,
      client_secret: this.config.clientSecret });
    const response = await this.request("https://discord.com/api/v10/oauth2/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("OAuth token exchange failed");
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") throw new Error("Invalid OAuth token response");
    const token = value as Record<string, unknown>;
    if (typeof token.access_token !== "string" || !token.access_token || !Number.isFinite(token.expires_in) ||
      typeof token.expires_in !== "number" || token.expires_in <= 0) throw new Error("Invalid OAuth token response");
    return { accessToken: token.access_token, expiresIn: token.expires_in };
  }

  private async get<T>(accessToken: string, path: string): Promise<T> {
    const response = await this.request(`https://discord.com/api/v10${path}`, {
      headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Discord OAuth API unavailable");
    return response.json() as Promise<T>;
  }

  async identity(accessToken: string): Promise<OAuthIdentity> {
    const value = await this.get<unknown>(accessToken, "/users/@me");
    if (!value || typeof value !== "object" || typeof (value as OAuthIdentity).id !== "string" ||
      typeof (value as OAuthIdentity).username !== "string") throw new Error("Invalid Discord user response");
    return value as OAuthIdentity;
  }

  async guilds(accessToken: string): Promise<OAuthGuild[]> {
    const value = await this.get<unknown>(accessToken, "/users/@me/guilds");
    if (!Array.isArray(value)) throw new Error("Invalid Discord guild response");
    return value.filter((row): row is OAuthGuild => row && typeof row.id === "string" && typeof row.name === "string" &&
      typeof row.owner === "boolean" && typeof row.permissions === "string" && /^\d{17,20}$/.test(row.id));
  }
}
