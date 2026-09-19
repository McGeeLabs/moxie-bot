# Docker deployment

Moxie can run on a Linux VPS using Docker Engine and the Docker Compose plugin.
Docker Desktop with Linux containers can use the same files on Windows.
The VPS needs outbound access to Discord; the base configurations open no inbound bot or database ports. The optional webhook override publishes a host-loopback port only; see [webhook setup](WEBHOOKS.md).

Both files passed validation with the official Compose CLI. Production-only dependency imports and missing-token startup were also verified in an isolated Windows copy. Actual Linux image builds and container smoke tests are configured in GitHub Actions; they have not been run locally because the development workspace has no Docker engine. The user confirmed Moxie is deployed and working on forge01. Private Docker-network Kuma test delivery is also confirmed. Detailed container smoke checks remain to be confirmed.

## Choose a setup

| Setup | Compose file | Database hostname |
| --- | --- | --- |
| Existing VPS PostgreSQL container (your current setup) | `compose.yaml` | `mcgee-postgres` |
| Fresh installation with a dedicated PostgreSQL container | `compose.standalone.yaml` | `postgres` |

Choose **one** Compose file. The standalone file is a complete alternative, not an override to merge with the existing-database file.

Use `.env` for native local development through the SSH tunnel. Use a separate `.env.docker` on the Docker host. Both files are ignored by Git and excluded from Docker builds. No secret values are baked into an image.

## Existing PostgreSQL container on forge01

For the current Windows-to-forge01 move with Uptime Kuma, use the [step-by-step forge01 setup guide](FORGE01_SETUP.md). It includes the source checkpoint and `compose.integrations.yaml` override so Kuma reaches `http://moxie-bot:3000` over `mcgee_proxy`, without a published host port.

Run these commands in a checkout of Moxie on the VPS. Docker and the Compose plugin must already be installed.

```bash
cp .env.docker.example .env.docker
chmod 600 .env.docker
docker inspect --format '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}' mcgee-postgres
```

Edit `.env.docker` with your token, connection string, and one of the existing database container's network names:

```env
DISCORD_TOKEN=YOUR_BOT_TOKEN
DISCORD_CLIENT_ID=YOUR_APPLICATION_ID
DISCORD_GUILD_ID=YOUR_COMMAND_DEPLOYMENT_GUILD_ID
MOXIE_DB_NETWORK=THE_EXISTING_NETWORK_NAME
DATABASE_URL=postgresql://YOUR_USER:URL_ENCODED_PASSWORD@mcgee-postgres:5432/YOUR_DATABASE?schema=public
```

Use the real database name and a role with the required access. The database must already exist. URL-encode special characters in credentials. The migration role needs permission to create/alter tables in the selected schema.

`mcgee-postgres` must resolve on the chosen Docker network (normally the container name or an existing network alias). This is a Docker network connection, so the SSH tunnel and a published PostgreSQL port are unnecessary. Do not copy the local `127.0.0.1:5433` URL into this deployment: inside the bot container, localhost refers to the bot itself.

Compose attaches the bot to both a normal outbound network and the external database network. The external network must already exist; Compose does not create or delete it. See [Docker's networking guide](https://docs.docker.com/compose/how-tos/networking/) for service names and external networks.

The bot container is explicitly named `moxie-bot`; `MOXIE_CONTAINER_NAME` can override this for a second installation. The Compose service remains `bot`. To apply the name update, recreate the service with `up -d bot` using the same checkout/project. Do not manually rename the container or change the Compose project name to achieve this.

Validate quietly to avoid printing resolved secrets, then build both images:

```bash
docker compose --env-file .env.docker -f compose.yaml --profile tools config --quiet
docker compose --env-file .env.docker -f compose.yaml --profile tools build
```

Review the checked-in migrations and back up an existing database before applying schema updates. Migrations are explicit; starting or restarting the bot does not run them automatically.

```bash
docker compose --env-file .env.docker -f compose.yaml run --rm migrate
docker compose --env-file .env.docker -f compose.yaml run --rm bot node dist/core/database/check.js
```

Stop a local bot instance using the same token before starting this one. Then start the bot and view its structured logs:

```bash
docker compose --env-file .env.docker -f compose.yaml up -d bot
docker compose --env-file .env.docker -f compose.yaml logs --tail 100 -f bot
```

Check `/ping`, `/health`, and `/modules` in Discord. The database should show connected, and saved guild settings should be preserved.

Command registration is separate from startup. If command definitions have changed, configure the application and target guild IDs, then run:

```bash
docker compose --env-file .env.docker -f compose.yaml run --rm bot node dist/deploy-commands.js
```

This replaces this application's commands in that guild. Global registration remains planned. The image already contains compiled JavaScript, so container commands use `node dist/...` rather than the native `npm run deploy` or `npm run db:check` scripts, which rebuild using development tooling.

## Fresh installation with PostgreSQL

Copy the same environment template, then change these settings. The password in `POSTGRES_PASSWORD` is raw; its representation in `DATABASE_URL` must be URL-encoded.

```env
POSTGRES_DB=moxie
POSTGRES_USER=moxie
POSTGRES_PASSWORD=YOUR_DATABASE_PASSWORD
DATABASE_URL=postgresql://moxie:URL_ENCODED_PASSWORD@postgres:5432/moxie?schema=public
```

Set the Discord token as above. `MOXIE_DB_NETWORK` is unused in this mode.

```bash
docker compose --env-file .env.docker -f compose.standalone.yaml --profile tools config --quiet
docker compose --env-file .env.docker -f compose.standalone.yaml --profile tools build
docker compose --env-file .env.docker -f compose.standalone.yaml up -d postgres
docker compose --env-file .env.docker -f compose.standalone.yaml run --rm migrate
docker compose --env-file .env.docker -f compose.standalone.yaml run --rm bot node dist/core/database/check.js
docker compose --env-file .env.docker -f compose.standalone.yaml up -d bot
```

The database uses PostgreSQL 17 with a persistent named volume and no published host port. Bot and migration startup wait for PostgreSQL's readiness check. This check confirms the server accepts connections; `database/check.js` additionally verifies the configured credentials with a real query.

Database initialization settings only take effect when PostgreSQL's data volume is empty. Changing the environment file does not change existing database credentials. Keep database backups outside the container.

## Updates and stopping

Pull the reviewed source changes on the VPS, rebuild both images, apply checked-in migrations, then recreate the bot with `up -d bot`. If a migration fails, resolve it before starting the new bot version. Never use `prisma migrate dev` or `db push` against production.

Stop the existing-database setup with:

```bash
docker compose --env-file .env.docker -f compose.yaml down
```

For standalone mode, use `-f compose.standalone.yaml`. Normal `down` preserves the named database volume; do not add `--volumes` when you intend to retain data. The existing VPS PostgreSQL container is not managed by `compose.yaml` and is left running.

The bot runs as the image's non-root `node` user. Compose forwards shutdown signals through its init process and allows 30 seconds for Discord and database connections to close. Logs go to stdout/stderr with Docker log rotation. The bot restarts unless explicitly stopped; diagnostics remain available when a database connection fails. No bot-specific container health check is implemented yet—use logs and `/health` for operational checks.

## Build layout

- `build`: installs the lockfile dependencies, generates Prisma's CommonJS client, and compiles TypeScript.
- `migrations`: retains Prisma CLI and schema/migrations; defaults to `prisma migrate deploy`.
- `runtime`: includes compiled application code and production dependencies, without TypeScript, Prisma CLI, or optional development peers.

GitHub Actions validates both Compose files with placeholder credentials, builds both Linux images, verifies the runtime user/imports and missing-token startup failure, and validates the Prisma schema inside the migration image. These checks do not connect to Discord or any real database.
