import { REST, Routes } from "discord.js";
import { CONFIG } from "./config";
import * as ping from "./commands/ping";
import * as about from "./commands/about";


const commands = [ping.data.toJSON(), about.data.toJSON()];

async function main() {
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);

  console.log("📡 Deploying guild commands…");
  await rest.put(
    Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId),
    { body: commands }
  );
  console.log("✅ Commands deployed.");
}

main().catch(console.error);
