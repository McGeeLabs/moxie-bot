# Valheim configuration and status

Scheduled checks and transition-only notifications are now implemented. Follow the [scheduled monitoring update guide](VALHEIM_MONITORING.md) after completing the setup below. The saved channel is now used for alerts when the module is enabled.

Moxie stores one Valheim server configuration per Discord guild and supports on-demand A2S_INFO queries. The `valheim` module starts disabled. All `/moxie valheim` commands require guild Administrator permissions and reply privately. Configuration and removal remain available when the module is disabled; status checks require it to be enabled.

## Verified Nitrado endpoint

The user supplied a standard, unmodded Nitrado server. A read-only query from the Windows development environment confirmed:

- `valheim.mcgeelabs.com` resolves to `85.190.156.180`.
- UDP port **10471** answers Valheim information queries.
- Port **10470** did not answer an information query; it remains the supplied game connection port.
- The response identifies the server as McGeeLabs Private Server and includes reported player capacity/count and password protection. These are observations at verification time, not permanently current values.

Nitrado distinguishes the game port from the query port in its [connection guide](https://server.nitrado.net/en-US/guides/connecting-to-a-valheim-gameserver-en). The actual Moxie adapter was verified against the supplied query endpoint. The user also confirmed a successful status query from forge01 displayed correctly in Discord, including reported players, latency, version, and password protection.

## Deploy this update

Commit and push the local changes on `dev`, then pull them on forge01. In the VPS Moxie checkout, define the helper if this is a new shell:

```bash
moxie() { docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml "$@"; }
```

Back up the existing database before applying this new additive migration. It creates only `ValheimServerConfig`; it does not replace guild/module/webhook tables. With the existing PostgreSQL container's admin role, a backup can be made on forge01:

```bash
mkdir -p ~/backups/moxie
chmod 700 ~/backups/moxie
docker exec mcgee-postgres sh -c 'exec pg_dump -U "${POSTGRES_USER:-postgres}" -Fc moxie_db' \
  > ~/backups/moxie/moxie-before-valheim-$(date +%Y%m%d-%H%M%S).dump
```

If this fails because the admin role or local authentication differs, resolve the backup using your existing database backup process. Do not treat a failed or empty dump as a successful backup. Then:

```bash
git pull --ff-only
moxie --profile tools config --quiet
moxie --profile tools build
moxie run --rm migrate
moxie run --rm bot node dist/deploy-commands.js
moxie up -d bot
moxie ps
moxie logs --tail 100 bot
```

The migration has not been applied from the Windows environment because the development PostgreSQL tunnel is closed. Run the checked-in migration on forge01 before using the new configuration commands. Redeploying commands adds the `valheim` group and module choice; reload Discord if its picker is stale.

The bot container now defaults to **moxie-bot**. Compose recreates its old `moxie-bot-bot-1` container on `up -d bot` when using the same checkout/project. Keep the same project directory and Compose files; do not manually rename the old container or change the project name. `MOXIE_CONTAINER_NAME` optionally overrides the default for another installation. The service remains `bot`, so existing Compose commands still use `bot`. Kuma's private `http://moxie-bot:3000/...` URL remains valid.

## Configure in Discord

Use Discord's command picker:

```text
/moxie valheim configure host:valheim.mcgeelabs.com game-port:10470 query-port:10471 channel:#monitoring
/moxie module name:valheim enabled:true
/moxie valheim status
```

The host excludes the port and URL prefix. `query-port` is optional and defaults to game port + 1, but using the verified explicit value is clearest here. The channel must be a same-guild text channel where the bot can view and send messages. It is used for scheduled alerts after applying the monitoring migration and image update.

Other commands:

```text
/moxie valheim config
/moxie valheim remove
```

Status displays a green card on a valid Valheim reply: server name, game connection address, query port, reported player count/capacity, query latency, reported version, and whether a password is required. It never stores or requests the game password. Failed checks display an amber **Query unavailable** card with a safe diagnostic.

## Limits and next milestone

- UDP only; a TCP port check does not validate Valheim availability.
- Each query has a five-second overall deadline, a bounded challenge exchange, and an 8 KiB response limit. A connected UDP socket accepts replies only from the target peer.
- No player-name or rules queries, Nitrado API login, game-server control, RCON, or mods are required.
- Results are cached for up to 15 seconds. Duplicate running checks for a guild and more than four concurrent checks are rejected with a retry message. Module/configuration checks happen before returning cached results.
- A timeout may mean offline, a wrong query port, filtering, or packet loss. It does not prove the game server is offline.
- The initial adapter supports single-packet A2S_INFO replies and challenge responses. Split/compressed replies are reported as unsupported. The supplied Nitrado server returned a single packet.
- Reported player counts and version depend on the server response. The observed Nitrado reply carries its game version in the `g=` tag; otherwise the basic A2S version may be a placeholder.
- Settings persist in PostgreSQL and are isolated by guild. The module starts disabled, and configuration changes do not enable it automatically.

Live VPS status is verified. Scheduled checks, repeated-failure handling, and saved restart baselines are implemented in the [next monitoring milestone](VALHEIM_MONITORING.md); live scheduled alerts remain to be verified after its migration and image update.
