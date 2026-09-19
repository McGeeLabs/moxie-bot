# Custom commands

Custom commands are simple saved text responses, isolated by Discord server. This first slice supports up to 50 commands per server. Names are 1–32 lowercase letters, digits, underscores, or hyphens, starting with a letter or digit; names entered with uppercase letters are normalized. Responses are 1–1,800 characters. Moxie suppresses all Discord mentions when posting saved text.

Administrators manage commands with private replies:

```text
/command add name:rules response:Be kind and read the pinned rules.
/command edit name:rules response:Please read the pinned rules.
/command list
/command delete name:rules
```

The administrator controls remain available even while the customCommands module is disabled. Enable it when the saved responses are ready for members:

```text
/module name:customCommands enabled:true
/rules
/commands
```

`/rules` posts the saved text in the channel. `/commands` shows names, not response bodies. Direct saved commands appear in that server's slash-command picker after `/command add` synchronizes them. `/command delete` removes the slash command. `/command sync` retries registration if Discord was temporarily unavailable. Built-in names are reserved. The per-server module setting gates member use.

## Deployment

The prior custom-command milestone added the `CustomCommand` table. This command-layout update needs no new migration. On forge01, from the Moxie checkout:

```bash
git pull --ff-only origin dev
docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml --profile tools build
docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml up -d bot
docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml run --rm bot node dist/deploy-commands.js
```

The last step registers the flattened built-in commands and all saved direct commands in the configured development guild. It removes the old `/moxie` and `/cmd` entries. Reload Discord if it still displays old definitions. The dashboard is unchanged.
