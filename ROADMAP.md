# Moxie Roadmap

This roadmap outlines the planned development phases for **Moxie**, a modular Discord bot platform.

The roadmap is intentionally flexible and may evolve as features are implemented.

---

## Current Status

**Phase 0 (Foundation)** is complete. Core reliability and guild configuration are implemented and covered by automated tests. Live `/moxie health`, module listing, disable/re-enable controls, and disabled `/about` blocking are confirmed by the user in Discord. Enabled `/about`, `/ping`, and persistence across a bot restart still need live verification. **Phase 1 (Core Platform)** remains the current priority.

### Milestone 1 — Core reliability and diagnostics

- [x] Review the original bot and preserve `/ping` and `/about`
- [x] Move implemented runtime infrastructure under `core/` and commands under `modules/admin/` and `modules/status/`
- [x] Share a module/command registry between runtime and deployment
- [x] Reject duplicate command names
- [x] Structured JSON logging with Discord-token redaction
- [x] Handle startup, deployment, client, command, and error-reply failures
- [x] Graceful shutdown on Ctrl+C / SIGTERM
- [x] Administrator-only `/moxie health` with runtime permission checks
- [x] Separate runtime token requirements from deployment ID requirements
- [x] Automated local tests and Linux CI configured for Node 22/24
- [x] Live `/moxie health` response confirmed by user (Discord ready, database connected)
- [ ] Verify `/ping` and `/about` against a live test guild

### Milestone 3 — Docker deployment preparation

- [x] Node 24 multi-stage image with non-root production runtime
- [x] Separate Prisma migration image and explicit migration commands
- [x] Compose configuration for existing VPS PostgreSQL network
- [x] Alternate standalone Compose configuration with PostgreSQL 17 and a persistent volume
- [x] Docker environment template independent of the native SSH-tunnel configuration
- [x] Exclude environment files and local dependencies/generated artifacts from builds
- [x] Graceful shutdown, restart policy, and Docker log rotation
- [x] Both Compose files validated locally with official Compose CLI and placeholder credentials
- [x] Verify production-only dependency imports and clean missing-token startup in an isolated Windows copy
- [x] Configure Linux image-build and runtime/tooling smoke checks in CI
- [x] Document existing-database and fresh-install workflows in `docs/DEPLOYMENT.md`
- [x] Prepare forge01 migration guide and private shared-network Compose override for Kuma
- [x] User completed VPS deployment and confirmed the bot works on forge01
- [ ] Complete detailed Linux container smoke checks
- [ ] Verify database connectivity, Discord commands, saved guild settings, and shutdown in containers
- [x] Deploy to forge01 (user confirmed running and working)

### Milestone 4 — Generic webhook integration

- [x] Optional Node HTTP listener, disabled by default; native loopback binding
- [x] Persist fixed guild/channel routes with unique per-guild names and hashed per-route tokens
- [x] Administrator-only create/list/rotate/delete commands with private token disclosure
- [x] Separate disabled-by-default `webhooks` guild module; admin recovery stays available
- [x] Constant-time token comparison, strict content-only payload validation, and mention suppression
- [x] Same-guild text-channel and View Channel / Send Messages checks at setup and delivery
- [x] Body/header limits, request/socket timeouts, route rate limits, and concurrency limits
- [x] Safe request/storage/delivery errors and graceful listener shutdown
- [x] Optional Docker host-loopback port override; both base/override combinations validated
- [x] Apply additive route migration and register commands in the development guild
- [x] 34 automated tests pass; live HTTP/PostgreSQL transaction verification with stub sender passes
- [x] Roll back verification records; send no real Discord notifications during automated verification
- [x] Document local setup, API contract, token rotation, limitations, and Docker configuration
- [x] User verified local listener, authenticated request returning delivered, and real notification in the monitoring channel
- [x] User confirmed live `monitor` route creation targeting the monitoring channel and guild webhook-module enablement
- [ ] Verify webhook listener in Linux containers
- [x] Add native Uptime Kuma push adapter (live test and DOWN notification confirmed; UP recovery pending)
- [x] Add native Valheim on-demand query adapter (live VPS status confirmed; scheduled alert implementation complete, live rollout pending)
- [ ] Add native Mealie adapter
- [ ] Durable queue, idempotency, signed payloads/replay handling (future reliability work)

### Milestone 5 — Uptime Kuma push notifications

- [x] Native JSON webhook adapter checked against Kuma 1.23.17 source
- [x] Saved route provider; existing routes default to generic
- [x] Separate disabled-by-default uptimeKuma guild module; both webhook and adapter toggles required
- [x] UP/DOWN/PENDING/MAINTENANCE and notifications without heartbeat metadata
- [x] Bounded display fields; monitor configuration excluded; shared authentication and mention suppression
- [x] Administrator route-provider choice and provider display in listing/token replies
- [x] Apply additive migration to the dedicated development database and register updated guild commands
- [x] 39 automated tests pass; HTTP/PostgreSQL verification with stub delivery rolled back
- [x] Setup guide for forge01 Docker to Windows development connectivity
- [x] Document Discord command-cache refresh and optional provider selection; guild registration includes provider and no duplicate global commands
- [x] User verified Kuma 1.23.17 test notification in Discord via relay/reverse tunnel after narrow UFW rule
- [x] User verified an actual Automation monitor DOWN alert after a deliberate invalid-hostname change
- [ ] Verify monitor UP recovery in Discord
- [x] User confirmed private Kuma test delivery over Docker networking after VPS deployment
- [x] Implement status-colored Discord embeds with bounded fields, route footer, and Embed Links permission checks
- [x] 40 automated tests pass, including actual embed send options, missing Embed Links, mention suppression, and generic text delivery
- [ ] Verify new card formatting live after rebuilding the VPS image

### Milestone 6 — Valheim configuration and on-demand status

- [x] Stable default bot container name moxie-bot in both Compose configurations
- [x] Verify supplied Nitrado hostname and UDP query port 10471 with read-only queries
- [x] Native A2S_INFO adapter with timeout, challenge limit, response-size limit, and safe diagnostics
- [x] Per-guild PostgreSQL configuration with separate game/query ports and reserved alert channel
- [x] Disabled-by-default valheim module and guild Administrator controls
- [x] Configure/config/status/remove commands and private status cards
- [x] Brief result cache, per-guild duplicate-check guard, and four-query concurrency limit
- [x] 53 automated tests pass, including actual local UDP challenge/response, timeout, malformed replies, scope, module gates, and concurrency
- [x] Verify the completed adapter against the real supplied Nitrado endpoint from Windows
- [x] Document source checkpoint, additive migration, container-name update, and exact Discord setup
- [x] User deployed the Valheim update on forge01 and successfully used saved configuration/status
- [x] User confirmed live Valheim status from forge01 in Discord with the new status card
- [ ] Verify Valheim configuration persistence across container restart
- [x] Implement scheduled checks and transition-only notifications after the status milestone was verified

### Milestone 7 — Scheduled Valheim monitoring and operations verification

- [x] Non-overlapping 60-second scheduler with up to four scheduled queries at once
- [x] Three-failure debounce and transition-only unavailable/recovery cards
- [x] Persist baseline, consecutive failures, last check, and last notified state
- [x] Quiet initial baseline and restart behavior; retry failed delivery without stale recovery alerts
- [x] Module/membership checks and guards against target removal/changes during a query
- [x] Stop scheduling and drain active checks before Discord/database shutdown
- [x] Scheduler activity, last completed cycle, and safe error counters in health
- [x] Extra roadmap item: implement a read-only configuration persistence verifier using counts and a combined fingerprint
- [x] Extra roadmap item: implement a VPS container smoke/restart verification script and add Bash syntax checks to CI
- [x] 67 automated tests pass, including restart baselines, debounce, delivery retry, stale-target guards, shutdown, health, and fingerprints
- [x] Update README and rollout/operations guides
- [ ] Apply monitoring migration and update images/commands on forge01
- [ ] Verify live scheduled notifications and run the container restart/persistence script on forge01

### Next milestones, in priority order

1. Verify enabled `/about`, `/ping`, and saved settings across a bot restart in Discord. Module listing and disable/re-enable controls are verified live. Guild sync, persistent toggles, admin controls, PostgreSQL/Prisma, and database health are implemented.
2. Complete container smoke checks and restart/shutdown verification. The user confirmed Moxie is deployed and working on forge01.
3. Verify webhooks in containers. Generic webhook delivery is confirmed live in Discord; the native Kuma adapter passes automated and PostgreSQL/HTTP checks.
4. Deploy the implemented Valheim scheduler and run its live monitoring and container restart/persistence checks. On-demand Valheim status is confirmed live.

These priorities come before the later community features listed below. PostgreSQL, guild configuration, generic webhooks, and the native Kuma push adapter are implemented. Generic webhook delivery and a native Kuma test notification are confirmed live in Discord. A real Kuma DOWN alert is also confirmed. VPS deployment is confirmed by the user. Direct Kuma test delivery over Docker networking is confirmed. Valheim configuration and on-demand queries are verified locally and live from forge01 in Discord. New card formatting on the VPS, Kuma UP recovery, detailed container checks, Valheim persistence across restart, and live scheduled Valheim alert verification remain pending.

**⚠️ Stability Notice**: Until Phase 1 is complete, breaking changes may occur (schema changes, command restructures, API modifications). For production deployments, wait until Phase 2 is stable. Check release notes when updating.

---

## Phase 0 — Foundation ✅ (Complete)

The foundational infrastructure is in place:

- [x] Discord.js v14 setup
- [x] TypeScript configuration
- [x] Static module and command registry
- [x] Typed event registration
- [x] Environment-based configuration
- [x] `/ping` command

---

## Phase 1 — Core Platform 🟡 (Priority)

**Estimated effort**: 2-3 weeks

Phase 1 establishes the database-backed infrastructure needed for all future features. **This phase is required before moving to feature phases.**

- [x] PostgreSQL connectivity and initial migration (verified on dedicated development database via SSH tunnel)
- [x] Prisma ORM v7 setup with PostgreSQL adapter and generated CommonJS client
- [x] Read-only `db:check` command, database health reporting, and disconnect on shutdown
- [x] Guild and module-configuration schema with guild/module uniqueness
- [ ] Resolve remaining Prisma CLI dependency audit findings (`deepmerge-ts`, `mysql2`; four high findings after compatible updates)
- [x] Multi-guild configuration behavior with isolated settings
- [x] Bot startup and guild-join sync (preserves existing choices)
- [x] Persistent module flags per guild; disabled and unavailable settings block execution
- [x] Shared guild Administrator permission check for all `/moxie` subcommands
- [x] `/moxie modules` listing and `/moxie module` enabled/disabled controls
- [x] Required admin module keeps `/ping`, health, and recovery controls available
- [x] 20 automated tests plus real PostgreSQL transaction verification (verification records rolled back)
- [x] Updated guild command definitions deployed to the development guild
- [x] Live module listing, disable/re-enable controls, and disabled `/about` blocking confirmed by user
- [ ] Verify saved module settings across a bot restart in Discord

**Blocking**: Phases 2, 3, and 5 depend on Phase 1 completion.

---

## Phase 2 — Custom Commands

**Estimated effort**: 1-2 weeks

Database-backed admin-defined commands. Enables server owners to create custom responses without code changes.

- [ ] Database schema for custom commands
- [ ] `/cmd <name>` command execution
- [ ] `/cmd add <name> <response>` create command (admin-only)
- [ ] `/cmd edit <name> <response>` update command
- [ ] `/cmd delete <name>` remove command
- [ ] Embed support for custom responses
- [ ] Command usage logging

**Depends on**: Phase 1

---

## Phase 3 — Moderation & Logs

**Estimated effort**: 1-2 weeks

Core moderation tooling for server safety and audit trails.

- [ ] Moderation commands: `warn`, `kick`, `ban`, `timeout`
- [ ] Moderation action logging to database
- [ ] Configurable log channels per guild
- [ ] Case IDs for mod actions (for easy reference)
- [ ] Mod action reason tracking
- [ ] Case history lookup command

**Depends on**: Phase 1

---

## Phase 4 — Reaction Roles

**Estimated effort**: 1 week

Self-service role assignment via reactions or button clicks.

- [ ] Reaction role message setup (admin command)
- [ ] Button-based role assignment (cleaner than reactions)
- [ ] Automatic role removal on button click
- [ ] Admin management commands
- [ ] Reaction role persistence across restarts

**Depends on**: Phase 1 (optional; could work without, but benefits from config persistence)

---

## Phase 5 — Leveling System

**Estimated effort**: 2 weeks

Gamification through XP, levels, and rewards.

- [ ] XP tracking with rate limiting (prevent spam gaming)
- [ ] Level calculation system
- [ ] `/rank` and `/leaderboard` commands
- [ ] Role rewards per level (e.g., "Achieved Level 10, get @Veteran role")
- [ ] Guild-specific leaderboards
- [ ] Foundation for future shop/economy

**Depends on**: Phase 1

---

## Phase 6 — Ticket System

**Estimated effort**: 1-2 weeks

Support-style ticket system for moderation and user inquiries.

- [ ] Button-based ticket creation
- [ ] Automatic private channel creation
- [ ] Permission management (user + mod team only)
- [ ] Ticket close & archive (saves channel as JSON/transcript)
- [ ] Optional transcript generation
- [ ] Ticket log channel per guild

**Depends on**: Phase 1

---

## Phase 7 — Web Admin Dashboard

**Estimated effort**: 3-4 weeks

User-friendly web interface for bot management, reducing CLI/code dependency.

- [ ] Discord OAuth authentication
- [ ] Guild selection & permission verification
- [ ] Custom command management UI (create, edit, delete)
- [ ] Reaction role UI (visual mapping builder)
- [ ] Moderation log viewer with filters
- [ ] Feature toggles per guild (enable/disable phases)
- [ ] Basic role reward configuration

**Tech**: Next.js (planned), React, TypeScript

**Depends on**: Phase 2+

---

## Phase 8 — Automation & MCP Integration

**Estimated effort**: 1-2 weeks

External event routing to Discord for automation workflows.

- [x] Generic HTTP webhook ingestion endpoint with per-route Bearer authentication
- [ ] Secure signature validation (prevent spoofing)
- [x] Generic content-event routing to fixed guild/text-channel destinations
- [ ] Status & summary commands
- [ ] Basic MCP (Model Context Protocol) hooks for future AI integration

**Depends on**: Phase 1

---

## Long-Term Ideas (Post-Phase 8)

These are aspirational features that will be considered after core stability is achieved:

- **Scheduled tasks & reminders** — calendar-based events, recurring announcements, birthday roles
- **AI-assisted summaries** — AI-powered message summaries for inactive channels or members
- **Public plugin system** — community-contributed modules with sandboxing (technical feasibility TBD)
- **Marketplace-style discovery** — showcase and install community plugins
- **Economy & Shop** — in-game currency, level-based purchases

---

## Phase Dependencies

```
Phase 0 (Foundation)
    ↓
Phase 1 (Core Platform) ← REQUIRED FOR ALL BELOW
    ├→ Phase 2 (Custom Commands)
    ├→ Phase 3 (Moderation & Logs)
    ├→ Phase 4 (Reaction Roles)
    ├→ Phase 5 (Leveling System)
    ├→ Phase 6 (Ticket System)
    └→ Phase 8 (Automation & MCP)
        ↓
    Phase 7 (Web Dashboard) ← Can start after Phase 2
```

**Key Blockers**:
- Phase 1 **must** complete before feature development
- Phase 7 dashboard is most useful after Phase 2+ are implemented

---

## Guiding Principles

These principles guide all development decisions:

- **Stability over features** — a reliable bot with fewer features beats a buggy one with many
- **Explicit permissions** — no implicit access; every action requires clear permission
- **Clear audit trails** — all actions are logged for compliance and debugging
- **Minimal Discord API abuse** — respect rate limits, use batch operations where possible
- **Self-hosted first** — code designed for easy self-hosting, no proprietary backend required
