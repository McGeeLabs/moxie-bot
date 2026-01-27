import { Client, Collection, GatewayIntentBits } from "discord.js";
import { CONFIG } from "./config";
import type { Event, MoxieClient } from "./types";

import * as ready from "./events/ready";
import * as interactionCreate from "./events/interactionCreate";
import * as ping from "./commands/ping";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
}) as MoxieClient;

client.commands = new Collection();
client.commands.set(ping.data.name, ping);

const events: Event[] = [ready, interactionCreate];

for (const evt of events) {
  if (evt.once) client.once(evt.name, (...args) => evt.execute(...args));
  else client.on(evt.name, (...args) => evt.execute(...args));
}

client.login(CONFIG.token);
