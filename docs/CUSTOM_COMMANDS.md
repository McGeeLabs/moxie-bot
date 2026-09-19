# Custom commands

Custom commands are simple saved text responses, isolated by Discord server. This first slice supports up to 50 commands per server. Names are 1–32 lowercase letters, digits, underscores, or hyphens, starting with a letter or digit; names entered with uppercase letters are normalized. Responses are 1–1,800 characters. Moxie suppresses all Discord mentions when posting saved text.

Administrators manage commands with private replies:

```text
/moxie command add name:rules response:Be kind and read the pinned rules.
/moxie command edit name:rules response:Please read the pinned rules.
/moxie command list
/moxie command delete name:rules
```

The administrator controls remain available even while the customCommands module is disabled. Enable it when the saved responses are ready for members:

```text
/moxie module name:customCommands enabled:true
/cmd run name:rules
/cmd list
```

`/cmd run` posts the saved text in the channel. `/cmd list` shows names, not response bodies. Unknown names return a short explanation. These commands are server-only. The shared module gate checks each server's saved setting before running a member command.

## Deployment

This feature adds one `CustomCommand` table. Apply the checked-in migration before starting the new bot image. On forge01, from the Moxie checkout:

```bash
git pull --ff-only origin dev
docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml --profile tools build
docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml run --rm migrate
docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml up -d bot
docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml run --rm bot node dist/deploy-commands.js
```

The last step registers the new `/cmd` and `/moxie command` definitions in the configured development guild. It replaces that application's guild command set. No dashboard change is needed yet; a management page can follow after the bot commands are verified.
