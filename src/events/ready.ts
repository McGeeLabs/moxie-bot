import type { Client } from "discord.js";

export const name = "clientReady";
export const once = true;

export function execute(client: Client) {
  console.log(`✅ Logged in as ${client.user?.tag}`);
}