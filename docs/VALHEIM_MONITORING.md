# Scheduled Valheim monitoring

The on-demand status milestone is verified live from forge01. This update adds scheduled checks, saved baseline/failure counters, and transition-only cards in each guild's saved Valheim channel.

## Update forge01

Publish the local changes to the `dev` branch, then in the existing forge01 checkout:

```bash
moxie() { docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml "$@"; }
git pull --ff-only
moxie --profile tools build
moxie run --rm migrate
moxie up -d bot
moxie run --rm bot node dist/deploy-commands.js
```

Back up the existing development database before applying pending migrations using the [Valheim guide](VALHEIM.md). This migration adds the monitoring-status enum and nullable baseline/notification/check-time fields plus a zero-default failure counter to the existing Valheim configuration table. It does not replace saved server settings.

No additional environment variables, listener ports, API credentials, or webhook routes are needed. Existing configured guilds with `valheim` enabled start monitoring automatically after the update. The saved text channel becomes the scheduled alert destination. Moxie needs View Channel, Send Messages, and Embed Links there. The `webhooks` toggle controls incoming webhooks and is independent of Valheim polling.

## Behavior

- Check immediately after startup, then every 60 seconds while the `valheim` module is enabled and Discord is ready for that guild.
- An initial successful query establishes a quiet online baseline. If initially unavailable, three failures establish a quiet unavailable baseline. No initial status announcement is sent.
- From an online baseline, require three consecutive failed queries before sending an amber **Query unavailable** card. A successful query resets the failure count.
- From an unavailable baseline, a successful query sends a green **Connection restored** card.
- Stable results do not send repeated cards. Unavailability means the information query failed; it does not prove that players cannot connect.
- Baseline, consecutive failures, last check time, and last notified state are saved in PostgreSQL and reused on restart.
- Failed alert delivery retains the last notified state, so a later matching check retries it. If an undelivered transition becomes obsolete, it is dropped rather than sending stale information.
- Changing the host, either port, or channel resets the baseline. Re-saving identical settings preserves it. Removing configuration stops monitoring; disabling the module pauses checks and alerts.
- Shutdown stops new work, waits for active checks, and suppresses new alert dispatches after stopping begins. Discord and the database are closed afterward.

Cycles do not overlap. Up to four scheduled queries run concurrently, and each cycle processes at most 100 configurations ordered by oldest check time, with never-checked ones first. For larger installations or slow batches, the interval is nominal: an active cycle skips intervening timer ticks. Scheduled queries bypass the on-demand 15-second cache so debounce counts reflect distinct checks.

## Verify

Run `/health` and confirm the scheduler is running and the last successful cycle advances. `/valheim config` shows the saved channel and interval. Existing settings do not need to be re-entered.

Local tests simulate failure/recovery, failed delivery retry, module/config changes during a query, restart baselines, and shutdown. They use stub senders and do not post real Discord notifications. Live scheduled alert delivery remains to be verified after deployment. Avoid interrupting the real game server just to test an alert; a separate test bot/guild and UDP test endpoint can exercise failure/recovery without affecting players. Reconfiguring an existing server resets the quiet baseline, so changing its host to an invalid hostname is not a reliable transition test.

Use the [deployment verifier](OPERATIONS.md) for the two accompanying roadmap items: saved configuration across restart and container startup/shutdown smoke checks.

Delivery is not exactly-once: a process crash after sending but before saving notification acknowledgement can duplicate an alert. Run one bot instance per application; distributed scheduling and durable event history are future work.
