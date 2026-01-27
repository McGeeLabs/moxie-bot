# Moxie Roadmap 🗺️

This roadmap outlines the planned development phases for **Moxie**, a modular Discord bot platform.

The roadmap is intentionally flexible and may evolve as features are implemented.

---

## Phase 0 — Foundation ✅

- [x] Discord.js v14 setup
- [x] TypeScript configuration
- [x] Modular command system
- [x] Event loader
- [x] Environment-based configuration
- [x] `/ping` command

---

## Phase 1 — Core Platform

- [ ] PostgreSQL integration
- [ ] Prisma ORM setup
- [ ] Multi-guild support (guild config table)
- [ ] Bot startup guild sync
- [ ] Feature flag system per guild

---

## Phase 2 — Custom Commands

- [ ] Database-backed custom commands
- [ ] `/cmd <name>` execution
- [ ] Admin-only create/edit/delete commands
- [ ] Embed support for custom responses
- [ ] Command usage logging

---

## Phase 3 — Moderation & Logs

- [ ] Moderation commands (`warn`, `kick`, `ban`, `timeout`)
- [ ] Moderation action logging
- [ ] Configurable log channels per guild
- [ ] Case IDs for mod actions

---

## Phase 4 — Reaction Roles

- [ ] Reaction role mappings
- [ ] Button-based role assignment
- [ ] Role removal handling
- [ ] Admin management commands

---

## Phase 5 — Leveling System

- [ ] XP tracking with rate limiting
- [ ] Level calculation system
- [ ] Rank/leaderboard commands
- [ ] Role rewards per level
- [ ] Foundation for shop/economy

---

## Phase 6 — Ticket System

- [ ] Button-based ticket creation
- [ ] Automatic channel creation
- [ ] Permission management
- [ ] Ticket close & archive
- [ ] Optional transcript generation

---

## Phase 7 — Web Admin Dashboard

- [ ] Discord OAuth authentication
- [ ] Guild selection & permissions
- [ ] Custom command management UI
- [ ] Reaction role UI
- [ ] Moderation log viewer
- [ ] Feature toggles per guild

---

## Phase 8 — Automation & MCP Integration

- [ ] HTTP webhook ingestion
- [ ] Secure signature validation
- [ ] Event routing to Discord
- [ ] Status & summary commands

---

## Long-Term Ideas

- Scheduled tasks & reminders
- AI-assisted summaries
- Public plugin system
- Marketplace-style modules

---

## Guiding Principles

- Stability over features
- Explicit permissions
- Clear audit trails
- Minimal Discord API abuse
