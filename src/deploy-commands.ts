import { REST, Routes } from "discord.js";
import { readDeploymentConfig } from "./core/config";
import { logger } from "./core/logger";
import { commands } from "./modules";

async function main() {
  const config = readDeploymentConfig();
  const rest = new REST({ version: "10" }).setToken(config.token);
  logger.info("Deploying guild commands", { guildId: config.guildId, count: commands.length });
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: commands.map(command => command.data.toJSON()),
  });
  logger.info("Commands deployed", { guildId: config.guildId });
}

void main().catch(error => {
  logger.error("Command deployment failed", error);
  process.exitCode = 1;
});
