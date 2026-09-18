# Move the current development bot to forge01

This moves the existing development bot into Docker on forge01. It reuses its Discord application and dedicated `moxie_db` database, preserving guild settings, webhook paths, and token hashes. No PostgreSQL data needs to be moved. Local development can continue later, but stop the VPS bot before running a local bot with the same token.

## 1. Publish the local source checkpoint

On Windows, in `E:\McGeeLabs\moxie-bot`, run tests and review the changes before committing:

```powershell
npm test
git status --short
git add -- src tests prisma docs .github Dockerfile compose.yaml compose.standalone.yaml compose.webhooks.yaml compose.integrations.yaml prisma.config.ts package.json package-lock.json tsconfig.json README.md ROADMAP.md .gitignore .dockerignore .env.example .env.docker.example
git diff --cached --stat
git diff --cached --name-only
git commit -m "Add modular bot foundation, PostgreSQL configuration, and Kuma webhooks"
git push origin HEAD
git branch --show-current
```

The source changes must be pushed before cloning on the VPS. Do not stage `.env` or `.env.docker`, use force-add for those files, or commit secrets. The two example environment files contain placeholders. Record the branch printed by the last command; use that branch below. Authentication for GitHub may be required.

## 2. Get the source on forge01

```bash
docker --version
docker compose version
mkdir -p ~/apps
cd ~/apps
git clone --branch YOUR_PUSHED_BRANCH https://github.com/McGeeLabs/moxie-bot.git
cd moxie-bot
```

If the checkout already exists, enter it and inspect `git status` before switching branches or pulling; preserve any VPS edits. These instructions assume a fresh checkout.

Find PostgreSQL's network:

```bash
docker inspect --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' mcgee-postgres
docker network inspect mcgee_proxy --format '{{.Name}}'
```

## 3. Create the VPS environment file

```bash
cp .env.docker.example .env.docker
chmod 600 .env.docker
nano .env.docker
```

Set these fields using the same development Discord token/application/guild IDs and database credentials as the local setup. Choose a PostgreSQL network printed above:

```env
DISCORD_TOKEN=YOUR_EXISTING_DEV_BOT_TOKEN
DISCORD_CLIENT_ID=YOUR_EXISTING_APPLICATION_ID
DISCORD_GUILD_ID=YOUR_EXISTING_TEST_GUILD_ID
MOXIE_DB_NETWORK=YOUR_POSTGRES_NETWORK
MOXIE_INTEGRATION_NETWORK=mcgee_proxy
DATABASE_URL=postgresql://YOUR_USER:URL_ENCODED_PASSWORD@mcgee-postgres:5432/moxie_db?schema=public
WEBHOOK_ENABLED=true
```

Preserve the existing URL-encoded credentials and actual database name; change the local tunnel host/port `127.0.0.1:5433` to `mcgee-postgres:5432`. The database must already exist. The fresh-install `POSTGRES_*` fields are unused here. Compose sets the webhook listener to container port 3000 on all container interfaces; there is no published host port.

Create a shell helper so every command uses both Compose files:

```bash
moxie() { docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml "$@"; }
```

This helper lasts only for the current shell; recreate it in later sessions while in the checkout directory. The integration override adds Kuma's network while retaining the bot's default/database networks.

## 4. Build and verify before starting

```bash
moxie --profile tools config --quiet
moxie --profile tools build
moxie run --rm migrate validate
moxie run --rm migrate
moxie run --rm bot node dist/core/database/check.js
moxie run --rm bot node dist/deploy-commands.js
```

The first Linux build has not been verified yet; stop and resolve failures before proceeding. The migration command applies checked-in migrations. They are already applied to the current development database, so normally it reports none pending. Back up the database before applying any future pending schema changes. Never run `migrate dev` on the VPS. `database/check.js` should report connected; command deployment should report success.

## 5. Start Moxie and check Discord

Make sure the Windows bot is stopped first. Then:

```bash
moxie up -d bot
moxie ps
moxie logs --tail 100 -f bot
```

Ctrl+C exits the log viewer without stopping the bot. Confirm Discord readiness, successful guild sync, and listener startup on port 3000. Check `/ping`, `/moxie health`, `/moxie modules`, and `/moxie webhook list`. Health should report database connected and webhook listening. Existing toggles/routes should still be present. The restart policy restarts the bot after Docker/host restart unless you explicitly stop it.

## 6. Switch Kuma to the private Docker URL

Edit the saved Kuma notification's Post URL to:

```text
http://moxie-bot:3000/webhooks/YOUR_EXISTING_KUMA_ROUTE_ID
```

Use the Kuma route path from `/moxie webhook list`, keep the existing bearer token in Kuma's Additional Headers, and retain JSON preset. Do not use the generic monitor route. No token rotation is needed because the database is unchanged. If the token was lost, rotate it privately and update Kuma.

Click **Test**, confirm the message in Discord, and **Save**. Restore the Automation monitor's original n8n URL if it is still changed for testing, then verify an UP notification. Confirm this notification is enabled on the chosen monitors.

## 7. Retire the temporary development connection

After private Docker delivery succeeds, stop the temporary relay if it is still running:

```bash
docker ps --filter name=moxie-dev-relay --format '{{.Names}}'
```

If listed, run `docker stop moxie-dev-relay`. Remove the development firewall rule if you added it:

```bash
sudo ufw delete allow in proto tcp from 172.18.0.4 to 172.18.0.1 port 3002
```

Close the old reverse SSH tunnel and PostgreSQL tunnel on Windows with Ctrl+C if still open. Private same-network Kuma delivery does not need the host relay, public webhook port, or that UFW exception.

## Updates and shutdown

From the VPS checkout, recreate the `moxie` helper above. For updates:

```bash
git pull --ff-only
moxie --profile tools build
moxie run --rm migrate
moxie run --rm bot node dist/deploy-commands.js
moxie up -d bot
```

Run command deployment when definitions change. `moxie stop bot` gracefully stops the bot; `moxie up -d bot` starts it again. `moxie down` removes this Compose project's containers/default network but preserves the external PostgreSQL container and external networks.
