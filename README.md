![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![TypeScript](https://img.shields.io/badge/typescript-blue)
![Discord.js](https://img.shields.io/badge/discord.js-v14-blueviolet)
![License](https://img.shields.io/github/license/McGeeLabs/moxie-bot)

# Moxie 🤖

**Moxie** is a modular, self-hosted Discord bot built with **TypeScript**, **Discord.js**, and **PostgreSQL**.

The goal of Moxie is to provide a powerful, extensible alternative to bots like **MEE6**, while giving server owners full control over features, data, and customization.

---

## ✨ Planned Features

- 🔧 Custom Commands (admin-defined, database-backed)
- 🎭 Reaction Roles
- 🛡️ Moderation Commands & Action Logs
- 🎉 Community / Fun Commands
- 📈 Leveling System (with future shop/economy support)
- 🎫 Ticket System (button-based)
- 🌐 Web Admin Dashboard (Discord OAuth)
- 🗄️ PostgreSQL-backed persistence
- 🔌 Future MCP / automation integrations

---

## 🧱 Tech Stack

- **Node.js**
- **TypeScript**
- **Discord.js v14**
- **PostgreSQL** (planned)
- **Prisma** (planned ORM)
- **Docker** (planned)
- **Next.js** (planned admin dashboard)

---

## 📂 Project Structure

moxie-bot/
├── src/
│   ├── commands/          # Slash commands
│   ├── events/            # Discord event handlers
│   ├── types.ts           # Shared bot typings
│   ├── config.ts          # Environment configuration
│   ├── deploy-commands.ts # Slash command registration
│   └── index.ts           # Bot entry point
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md

---

## 🚀 Getting Started

### 1️⃣ Install dependencies

npm install

---

### 2️⃣ Configure environment variables

cp .env.example .env

Fill in the following values:

- DISCORD_TOKEN — your bot token
- DISCORD_CLIENT_ID — application client ID
- DISCORD_GUILD_ID — test server ID (guild deploy for fast iteration)

---

### 3️⃣ Deploy slash commands

npm run deploy

---

### 4️⃣ Start the bot (development mode)

npm run dev

If successful, you should see:

✅ Logged in as Moxie#1234

---

## 🧪 Current Commands

- /ping — verify the bot is online and responsive

---

## 🔐 Permissions

Moxie uses Discord’s built-in permission system and will later support:

- Role-based access control per module
- Admin-only command restrictions
- Feature-level permissions configurable per guild

---

## 🗺️ Roadmap

See ROADMAP.md for detailed milestones and planned features.

---

## 🧠 Design Philosophy

Moxie is designed to be:

- **Self-hosted** — no vendor lock-in
- **Modular** — features enabled per guild
- **Multi-guild** — built-in from day one
- **Extensible** — clean architecture for future growth

---

## 📄 License

MIT