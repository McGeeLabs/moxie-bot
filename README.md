<div align="center">

<!-- Logo -->

<picture>
  <!-- Dark mode -->
  <source media="(prefers-color-scheme: dark)" srcset="./branding/moxie-mark-dark.png">
  <!-- Light mode -->
  <img alt="Moxie" src="./branding/moxie-mark-light.png" width="128" height="128">
</picture>

<h1>Moxie</h1>

<p>
  <strong>Calm. Reliable. Alive.</strong><br/>
  Self-hosted Discord automation and community tooling.
</p>

<!-- Badges -->

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.1.0-2563EB?style=flat-square&labelColor=0F172A" />
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-22C55E?style=flat-square&labelColor=0F172A" />

  <a href="https://github.com/McGeeLabs/moxie-bot/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/McGeeLabs/moxie-bot?style=flat-square&labelColor=0F172A&color=2563EB" />
  </a>

  <a href="https://github.com/McGeeLabs/moxie-bot/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/McGeeLabs/moxie-bot/ci.yml?branch=main&style=flat-square&label=ci&labelColor=0F172A&color=22C55E" />
  </a>

  <a href="https://github.com/sponsors/McGeeLabs">
    <img src="https://img.shields.io/badge/sponsor-GitHub-2563EB?style=flat-square&labelColor=0F172A" />
  </a>
</p>

</div>

---

**Moxie** is a modular, self-hosted Discord automation and community platform built with **TypeScript**, **Discord.js**, and **PostgreSQL**.

It combines traditional Discord features such as moderation, roles, tickets, and community tools with integrations for self-hosted services, game servers, monitoring platforms, webhooks, and automation workflows.

Moxie is designed around one core principle:

> **Your server. Your data. Your automation.**

---

## ✨ What Moxie Will Do

Moxie is being built as a collection of independent modules that can be enabled or disabled per Discord server.

### 🤖 Core Bot

* Slash command framework
* Multi-guild support
* Per-guild configuration
* Module enable / disable controls
* Permission and role-based access controls
* Structured logging
* Health and diagnostics commands
* Scheduled tasks and background jobs

### 🖥️ Server & Service Monitoring

* Game server status
* Player counts
* Service availability
* Maintenance notifications
* Restart announcements
* Uptime Kuma integration
* Configurable status channels
* Health checks for connected services

### 🎮 Game Server Integrations

Planned integrations include support for game server monitoring and administration.

Initial targets include:

* Valheim
* Server availability
* Player status
* Restart notifications
* Maintenance messages
* Future game-specific commands

### 🔌 Automation & Integrations

Moxie is intended to work alongside existing automation platforms rather than replace them.

Planned integration support includes:

* Generic webhook endpoints
* REST API integrations
* n8n workflows
* Uptime Kuma
* Mealie
* Self-hosted services
* External APIs
* Scheduled automation
* Future MCP integrations

Example workflow:

```text
Mealie
   │
   ▼
  n8n
   │
   ▼
Moxie Webhook API
   │
   ▼
Discord
```

Moxie handles the Discord-facing experience while tools such as n8n handle larger workflow orchestration.

---

## 👥 Community Features

Planned community features include:

* 🔧 Custom commands
* 🎭 Reaction and button roles
* 👋 Welcome and leave messages
* 📢 Announcement tools
* 📊 Polls
* 🎉 Community and fun commands
* 📈 Leveling system
* 🛒 Optional future economy / shop system
* 🎫 Ticket system

---

## 🛡️ Moderation

Moxie will provide a configurable moderation toolkit including:

* Warnings
* Timeouts
* Kicks
* Bans
* Moderation notes
* Action history
* Moderation log channels
* Role-based moderation permissions
* Audit logging

Moderation features will be designed around explicit permissions and clear accountability.

---

## 🩺 Moxie Health

Moxie includes built-in health diagnostics and module controls for administrators. Broader service diagnostics are planned.

Available now: `/moxie health`, `/moxie modules`, and `/moxie module`. Additional planned commands include:

```text
/moxie status
/moxie health
/moxie modules
/moxie info
/moxie config
```

Example:

```text
Moxie Health

Bot
Online: 14d 7h
Latency: 31 ms

Database
PostgreSQL: Connected
Latency: 4 ms

Services
Uptime Kuma: Connected
Valheim: Online
Mealie: Online
n8n: Online

Version
Moxie v0.3.2
```

---

## 🌐 Web Dashboard

A web-based administration dashboard is planned for future releases.

The dashboard will use Discord OAuth and provide an interface for managing:

* Guild configuration
* Enabled modules
* Custom commands
* Reaction roles
* Moderation settings
* Ticket configuration
* Leveling settings
* Connected integrations
* Service monitoring
* Webhooks
* Permissions

The dashboard and Discord commands will share the same application logic and database.

---

## 🧱 Tech Stack

### Current

* **Node.js 22.12+** (Node 24 recommended; CI checks Node 22 and 24)
* **TypeScript**
* **Discord.js v14**
* **PostgreSQL** (PostgreSQL 17 verified)
* **Prisma ORM v7**
* **Generic incoming webhook API** (optional listener and per-guild routing)

### Planned

* **Next.js**
* **Discord OAuth**
* **Additional REST API and native service adapters**

---

## 🧩 Architecture

Moxie is designed around independent modules rather than one large command system.

Each module can own its:

* Commands
* Events
* Services
* Configuration
* Scheduled tasks
* Database logic
* Permissions

Current implemented structure:

```text
src/
├── core/
│   ├── client/index.ts          # Client creation and typed event registration
│   ├── config/index.ts          # Separate runtime/deployment validation
│   ├── database/                # Prisma, guild settings, health, disconnect
│   ├── events/                 # Ready and interaction handlers
│   ├── logger/index.ts         # JSON logs to stdout/stderr
│   └── permissions/index.ts    # Shared guild Administrator check
├── modules/
│   ├── index.ts                # One registry for runtime and deployment
│   ├── definitions.ts          # Module defaults and required modules
│   ├── admin/                  # Always available: ping, moxie/module/webhook controls
│   └── status/                 # Toggleable: about
├── integrations/
│   └── webhooks/               # HTTP receiver, authenticated routes, Discord delivery
├── types.ts                    # Shared command, module, and client types
├── deploy-commands.ts
└── index.ts                    # Startup and graceful shutdown
```

To add a command, export `data` and `execute` from its module file and add it to that module's command list in `src/modules/index.ts`. Duplicate command names are rejected. Only implemented folders are created; service adapters, scheduling, and other modules will be added when needed. Module metadata lives in `src/modules/definitions.ts`; command implementations are registered in `src/modules/index.ts`. Guilds and default module settings are registered on startup and when the bot joins a server. Toggleable commands check the current guild setting before executing. Repeated registration adds missing defaults without overwriting existing choices.

Logs contain timestamp, level, message, and explicit diagnostic metadata. Command failures include command and guild IDs; error replies never expose stack traces. The configured Discord token and generated webhook Bearer headers are redacted from log output. Runtime startup requires only `DISCORD_TOKEN`; deployment additionally requires valid application and guild IDs. Startup/deployment failures exit with a nonzero status. Ctrl+C and Linux SIGTERM destroy the Discord client before exit.

Planned architecture:

```text
moxie-bot/
├── src/
│   ├── core/
│   │   ├── client/
│   │   ├── config/
│   │   ├── database/
│   │   ├── events/
│   │   ├── logger/
│   │   ├── permissions/
│   │   └── scheduler/
│   │
│   ├── modules/
│   │   ├── admin/
│   │   ├── customCommands/
│   │   ├── moderation/
│   │   ├── reactionRoles/
│   │   ├── tickets/
│   │   ├── leveling/
│   │   ├── status/
│   │   ├── valheim/
│   │   ├── uptimeKuma/
│   │   └── mealie/
│   │
│   ├── integrations/
│   │   ├── webhooks/
│   │   ├── uptimeKuma/
│   │   ├── valheim/
│   │   └── mealie/
│   │
│   ├── shared/
│   │   ├── embeds/
│   │   ├── permissions/
│   │   ├── types/
│   │   └── utils/
│   │
│   ├── deploy-commands.ts
│   └── index.ts
│
├── branding/
├── .env.example
├── .gitignore
├── LICENSE
├── package.json
├── package-lock.json
├── tsconfig.json
├── README.md
└── ROADMAP.md
```

The exact structure may evolve as development continues.

---

## 🚀 Getting Started

### 1️⃣ Clone the repository

```bash
git clone https://github.com/McGeeLabs/moxie-bot.git
cd moxie-bot
```

### 2️⃣ Install dependencies

```bash
npm install
```

### 3️⃣ Configure environment variables

Copy the example environment file in Windows PowerShell (Linux: `cp .env.example .env`):

```bash
Copy-Item .env.example .env
```

Configure the required values:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
```

### Environment Variables

| Variable            | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `DISCORD_TOKEN`     | Discord bot token                                             |
| `DISCORD_CLIENT_ID` | Required for command deployment: application client ID                                 |
| `DISCORD_GUILD_ID`  | Required for deployment: target development/test guild |

> Never commit your `.env` file or Discord bot token to source control.

---

## ⚡ Deploy Slash Commands

```bash
npm run deploy
```

During development, commands are deployed to the configured test guild so changes appear quickly.

Global command deployment will be supported for production environments.

---

## ▶️ Start Moxie

Development mode:

```bash
npm run dev
```

If startup succeeds, Moxie should report that it successfully connected to Discord.

Example:

```text
{"level":"info","message":"Moxie connected to Discord","user":"Moxie#1234"}
```

---

## 🧪 Current Commands

### `/ping`

Checks whether Moxie is online and responding.

Example:

```text
/ping
```

Response:

```text
Pong!
```

### `/about`

Shows the version, process uptime, API latency, gateway latency, and project support link.

### `/moxie health`

Administrator-only, guild-only diagnostics with an ephemeral response. Shows Discord readiness, process uptime, and gateway latency. Database health performs a read-only `SELECT 1` and reports connected, unavailable, or not configured. The reply is deferred while the query runs. Health also reports whether the optional webhook listener is running. Health reports Uptime Kuma push-adapter support; it does not claim a live Kuma connection. Permission is checked at execution as well as in the command definition.

### `/moxie modules` and `/moxie module`

List or change module settings for the server where the command is invoked. Both require Administrator permission and respond privately:

```text
/moxie modules
/moxie module name:status enabled:false
/moxie module name:status enabled:true
```

The **admin** module is required: `/ping`, `/moxie health`, and module controls always remain available. The **webhooks** module defaults to disabled and gates incoming notification delivery. The **status** module currently owns `/about`; disabling status blocks `/about` in that guild only. Other guilds retain their own settings. Disabled commands remain registered in Discord and explain that their module is disabled when invoked.

Settings persist across restarts. When Moxie starts or joins a guild, missing default settings are inserted without resetting existing choices. A configurable command also retries registration, so a temporary startup database failure does not require a restart after connectivity returns. Guild records are retained when Moxie leaves a server so rejoining preserves configuration; automatic data cleanup is not implemented yet.

If the database cannot be reached, configurable commands stop with a clear configuration-unavailable message. They do not assume a module is enabled. `/ping` and health diagnostics remain available, while module listing and updates require PostgreSQL. `/about` is guild-only and defers its response while configuration is checked.

### `/moxie webhook`

Administrator-only route controls: `create`, `list`, `rotate`, and `delete`. Each route has a generated token, a fixed guild/text-channel destination, and a hash stored in PostgreSQL. Management replies are private; tokens are shown only at creation/rotation. Generic routes accept plain-text content; Uptime Kuma routes accept native JSON notifications. Both suppress mentions, check destination permissions, and enforce payload and rate/concurrency limits.

Enable the optional local listener with `WEBHOOK_ENABLED=true` in `.env`, then enable the guild's **webhooks** module with `/moxie module name:webhooks enabled:true`. Defaults are disabled and localhost port 3000. Follow the [webhook setup and test guide](docs/WEBHOOKS.md) for commands and a PowerShell request that prompts securely for the token. The migration is applied to the current development database; new databases need `npm run db:migrate:deploy`.

### Uptime Kuma

Live test delivery from Kuma 1.23.17 is confirmed both through the Windows development bot and directly over forge01 Docker networking. A real DOWN alert is also confirmed; UP recovery remains to be verified. Kuma notifications now use status-colored Discord cards with monitor details and optional latency/time. Rebuild the VPS image to enable this formatting; Moxie needs Embed Links in the destination channel.

Native Uptime Kuma JSON webhook notifications are supported through a dedicated route provider and disabled-by-default `uptimeKuma` module. Create a route with `/moxie webhook create name:kuma channel:#monitoring provider:Uptime Kuma`, then enable both `webhooks` and `uptimeKuma` for the guild. Existing generic routes keep their original format. Follow the [Uptime Kuma setup guide](docs/UPTIME_KUMA.md), including connectivity from forge01 to your local Windows bot.

### Verify locally

```powershell
npm test
npm run deploy
npm run dev
```

Invite the bot to your test server using the `bot` and `applications.commands` scopes; no privileged gateway intents are needed. Run `/ping` and `/about`, then `/moxie health` and `/moxie modules` as an administrator. Disable status, confirm `/about` is blocked and `/ping` still works, then re-enable status. Restart and check that settings persist. `/ping` should reply with Pong and edit in the response latency. Check that a non-administrator cannot execute health. Stop with Ctrl+C and confirm the shutdown log.

Tests use mock interactions, without Discord credentials or network calls. Live Discord verification is a separate step. `npm run deploy` replaces this application's command list in the target guild; the shared registry includes all three commands. It does not restrict which guilds the running bot can serve. Persistent per-guild settings are implemented; global command deployment remains planned.

For a compiled run, use `npm run build` followed by `npm start`. Use `npm ci` for reproducible installs from the lockfile.

---

## 🔐 Permissions

Moxie uses Discord's native permission system and a shared runtime Administrator check for every `/moxie` subcommand. Toggleable module commands also check their guild's persisted enabled setting. Broader role-based access controls are planned.

Planned permission features include:

* Role-based module access
* Administrator-only commands
* Moderator permissions
* Per-command restrictions
* Per-module permissions
* Guild-specific configuration
* Audit trails for administrative actions

Permissions will follow the principle of least privilege wherever practical.

---

## 🗄️ Data & Persistence

Persistent data uses **PostgreSQL** through **Prisma ORM v7** and its PostgreSQL driver adapter. The first migration creates `Guild` (Discord guild ID as a string) and `GuildModuleConfig` (unique guild/module pair, enabled flag). The second creates `WebhookRoute` with fixed destinations, per-guild names, and hashed tokens. The third adds a provider with a generic default, preserving existing routes. Guilds are automatically registered on startup and guild join. Module settings are managed through administrator commands and enforced before configurable commands execute.

### Local development through an SSH tunnel

For the current VPS Docker setup, keep this command running in a separate PowerShell window:

```powershell
ssh -N -L 127.0.0.1:5433:172.19.0.2:5432 forge01
```

The container IP can change after recreation. On the VPS, discover it with:

```bash
docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' mcgee-postgres
```

Use a dedicated Moxie development database. Add its connection string to `.env`, using your actual credentials and database name:

```env
DATABASE_URL="postgresql://moxie:URL_ENCODED_PASSWORD@127.0.0.1:5433/moxie_dev?schema=public"
```

URL-encode special characters in credentials. Never commit `.env`, print the connection string, or use a production database for local migration development. PostgreSQL does not need a publicly published port.

```powershell
npm ci
npm run db:validate
npm run db:check
npm run db:migrate:deploy
```

`db:check` only runs `SELECT 1`; it neither creates tables nor changes records. `db:migrate:deploy` applies the checked-in migrations and changes the database schema. The initial migration has been applied and verified on the current dedicated development database. New installations still need to apply it.

After editing `prisma/schema.prisma`, create a new migration against a development database with `npm run db:migrate:dev -- --name describe_change`. This command requires a shadow database (or permission to create one); do not run it against production. Production uses reviewed, checked-in migrations with `db:migrate:deploy`.

Client generation is part of `npm run build` and `npm run dev`; generated code is ignored by Git. Builds and automated tests require no database credentials or live connection. Prisma CLI settings live in `prisma.config.ts`. The generated client retains the project's CommonJS format; see the [Prisma generator documentation](https://www.prisma.io/docs/orm/prisma-schema/overview/generators).

At startup, the bot checks database connectivity but remains available if the database is unreachable. `/moxie health` checks current connectivity on each invocation. Shutdown closes the Prisma connection pool. Keep the SSH tunnel open while developing. For a future Docker deployment, use the database's Docker service/network name in `DATABASE_URL` rather than the local tunnel address.

Planned stored data includes:

* Guild configuration
* Module settings
* Custom commands
* Reaction roles
* Moderation actions
* Tickets
* Leveling data
* Integration settings
* Service configuration

Moxie is self-hosted, meaning server owners retain control over their own database and configuration.

---

## 🐳 Docker

For the current forge01 setup, follow the [Windows-to-VPS migration steps](docs/FORGE01_SETUP.md). The optional `compose.integrations.yaml` connects Moxie privately to Kuma's `mcgee_proxy` network, replacing the development relay and tunnels.

Docker deployment files are prepared for Linux/VPS hosting and Docker Desktop with Linux containers:

* `Dockerfile`: Node 24 multi-stage build, non-root bot runtime, and a separate Prisma migration image.
* `compose.yaml`: uses your existing VPS PostgreSQL container on its Docker network.
* `compose.standalone.yaml`: a fresh installation with PostgreSQL 17 and a persistent volume.
* `.env.docker.example`: a separate Docker-host environment template, keeping the local SSH-tunnel `.env` independent.

Both Compose files have passed validation with placeholder credentials. GitHub Actions is configured to build and smoke-test the Linux images. The user confirmed Moxie is running and working on forge01. Local container builds remain unavailable because Docker is not installed in the Windows workspace. Direct Kuma delivery over Docker networking is confirmed; detailed restart/shutdown checks remain to be confirmed.

Start with the [Docker deployment guide](docs/DEPLOYMENT.md). It covers your `mcgee-postgres` network, environment setup, explicit migrations, database verification, startup, updates, and shutdown. An optional `compose.webhooks.yaml` override publishes the webhook listener only on host loopback; see [webhook deployment](docs/WEBHOOKS.md). Use the container hostname on the VPS rather than `127.0.0.1:5433`.

---

## 🗺️ Roadmap

Development is organized into incremental phases so Moxie remains usable throughout development.

Major milestones include:

```text
Core Framework
      ↓
Database & Guild Configuration
      ↓
Integration Framework
      ↓
Server Monitoring
      ↓
Community Features
      ↓
Moderation
      ↓
Tickets
      ↓
Leveling
      ↓
Web Dashboard
      ↓
Advanced Automation
```

See [ROADMAP.md](https://github.com/McGeeLabs/moxie-bot/blob/main/ROADMAP.md) for detailed milestones and development progress.

---

## 🧠 Design Philosophy

Moxie is designed around a few core principles.

### Self-Hosted

Your bot, database, configuration, and integrations remain under your control.

### Modular

Features should be independently enabled or disabled per guild.

### Multi-Guild

Multi-server support is part of the architecture from the beginning.

### Reliable

Core functionality should remain stable even as additional modules are added.

### Observable

Administrative actions, failures, integrations, and automated processes should provide useful logs and diagnostics.

### Explicit Permissions

Administrative and automation features should never rely on vague or overly broad permission assumptions.

### Extensible

New modules and integrations should be easy to add without restructuring the entire bot.

### API Conscious

Discord API usage should be deliberate, efficient, and respectful of rate limits.

---

## 🎯 Project Goals

Moxie is not intended to reproduce every feature offered by every Discord bot.

Instead, the goal is to create a dependable platform that can grow around the needs of the communities and infrastructure using it.

That includes:

* Discord community management
* Moderation
* Game server integration
* Homelab monitoring
* Self-hosted service notifications
* Workflow automation
* Custom integrations

---

## 🚫 Non-Goals

Moxie is currently **not** intended to become:

* A Discord music bot
* A hosted SaaS platform
* A replacement for full workflow platforms such as n8n
* A closed-source premium bot
* A system that requires McGeeLabs infrastructure to operate

The primary deployment model will remain self-hosted.

---

## 🤝 Contributing

Contributions, bug reports, and feature suggestions are welcome.

You can help by:

* ⭐ Starring the repository
* 🐛 Reporting bugs
* 💡 Suggesting features
* 🧪 Testing development releases
* 🔧 Submitting pull requests
* 📖 Improving documentation

Please keep contributions aligned with Moxie's modular architecture and design philosophy.

---

## 💖 Supporting Moxie

Moxie is **100% open source** and free to self-host.

If you find Moxie useful and want to support continued development, you can:

* ⭐ Star the repository
* 🐛 Report issues
* 🔧 Contribute code
* 💖 Sponsor McGeeLabs on GitHub

👉 **GitHub Sponsors:** https://github.com/sponsors/McGeeLabs

There are **no paid features** and **nothing locked behind a paywall**.

Support is completely optional and appreciated.

---

## 📄 License

Moxie is licensed under the [MIT License](https://github.com/McGeeLabs/moxie-bot/blob/main/LICENSE).

---

<div align="center">

**Moxie**

*Calm. Reliable. Alive.*

Built by [McGeeLabs](https://github.com/McGeeLabs)

</div>
