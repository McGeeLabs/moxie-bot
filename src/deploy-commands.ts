import { REST, Routes } from "discord.js";
import { readDeploymentConfig } from "./core/config";
import { logger } from "./core/logger";
import { guildCommandDefinitions } from "./modules/customCommands/registration";

async function main() {
  const config = readDeploymentConfig();
  const rest = new REST({ version: "10" }).setToken(config.token);
  const definitions = await guildCommandDefinitions(config.guildId);
  logger.info("Deploying guild commands", { guildId: config.guildId, count: definitions.length });
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: definitions,
  });
  logger.info("Commands deployed", { guildId: config.guildId });
}

void main().catch(error => {
  logger.error("Command deployment failed", error);
  process.exitCode = 1;
});
