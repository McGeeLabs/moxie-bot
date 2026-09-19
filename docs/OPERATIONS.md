# Verify a VPS deployment

These tools cover two follow-up roadmap items: saved configuration across restarts and container startup/shutdown smoke checks. They are ready for forge01; actual execution on the VPS remains a user verification step. No container restart was performed from the Windows workspace.

## Deployment checks

After deploying the latest images and migrations, run from the forge01 checkout:

```bash
bash scripts/verify-deployment.sh
```

This uses `.env.docker`, `compose.yaml`, and `compose.integrations.yaml`. It checks:

- The Compose configuration without printing resolved secrets.
- A running bot container and its non-root runtime.
- Production dependencies and application/generated-client imports.
- PostgreSQL connectivity with a read-only query.
- Prisma tooling/schema validity and migration status.
- A read-only configuration snapshot.

It neither stops the running bot nor sends Discord messages. It runs short-lived migration tooling containers and a separate Node process for runtime checks.

To additionally verify graceful shutdown, Discord readiness after restart, and configuration persistence:

```bash
bash scripts/verify-deployment.sh --restart
```

This briefly stops the bot, checks exit code 0, starts it again, waits up to 60 seconds for Discord readiness and completion of guild sync in the logs, and compares configuration snapshots. If a check fails while the bot is stopped, cleanup attempts to start it again. Inspect the reported failure before retrying; do not assume a failed check passed.

Snapshots are temporary files with private permissions. They contain counts and a combined SHA-256 fingerprint, not settings, connection strings, tokens, or individual token hashes. The fingerprint includes guild identities, module flags, webhook route/destination/provider/token-hash data, Valheim host/ports/channel data, moderation destinations, and moderation cases. It excludes Valheim's operational monitoring state and check timestamps, which legitimately change while monitoring runs. Creating or correcting a moderation case during the restart test will cause a mismatch, so avoid moderation commands during that brief check.

The restart script supports the current existing-PostgreSQL forge01 setup, not the alternate standalone database file. Local Bash syntax checks and application tests pass; actual Docker-host checks remain pending until the user runs the script.

## Manual persistence verification

Define the existing `moxie` shell helper from [forge01 setup](FORGE01_SETUP.md). Capture a snapshot on the VPS:

```bash
umask 077
moxie run --rm bot node dist/core/database/verifyPersistence.js snapshot > moxie-persistence.json
```

After restarting the bot, compare it from a one-off container:

```bash
moxie run --rm -v "$PWD/moxie-persistence.json:/app/persistence.json:ro" bot \
  node dist/core/database/verifyPersistence.js verify /app/persistence.json
```

The read-only mount makes the snapshot available to the container. A match exits 0; an invalid snapshot, changed settings, or database problem exits 1 with a safe message. Delete the snapshot after use. Local native runs can use the same compiled Node command directly with a local file path.

## Scheduled monitoring health

`/moxie health` now reports whether the Valheim scheduler is running, whether a cycle is active, the last successful cycle time, last-cycle query totals, and cumulative scheduler/delivery error counts. These counters reset on process restart; saved monitor baseline and failure counts live in PostgreSQL.

Use `moxie logs --tail 100 bot` for startup, safe task-failure, transition-delivery, and shutdown messages. Scheduler failures are retried on subsequent cycles. A database SELECT 1 succeeding alone does not establish that all migrations are applied; the deployment verifier checks migration status too.
