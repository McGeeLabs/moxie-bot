# Moderation setup

Moxie's first moderation milestone provides guild-specific audit logging, durable warnings, warning history, and Discord timeouts. The `moderation` module starts disabled in every guild.

## Behavior and permissions

- `/warn member reason` records a warning in PostgreSQL, sends an audit card, and returns its case ID.
- `/warnings member` privately shows the newest 10 warnings and the total count.
- `/timeout member minutes reason` applies a Discord timeout for 1 minute through 28 days.
- `/untimeout member reason` removes an active timeout.
- All four commands require Discord's **Moderate Members** permission and respond privately.
- A moderator cannot target themselves, bots, the server owner, or a member whose highest role is equal to or above theirs.
- Timeout changes also require Moxie's highest role to be above the target and require Moxie to have **Moderate Members**.
- Reasons are limited to 500 characters. Mentions in confirmations, history, and log cards are suppressed.

Warnings remain stored if an administrator removes or changes the log-channel configuration. A warning is not discarded when Discord temporarily rejects its audit-card delivery. Timeouts are Discord actions; this milestone logs them to the configured channel but does not yet store timeout cases in PostgreSQL.

## Deploy on forge01

This update includes an additive migration for `ModerationConfig` and `ModerationWarning`. Back up the Moxie database before applying it. In the existing VPS checkout:

```bash
moxie() { docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml "$@"; }
git pull --ff-only
moxie --profile tools build
moxie run --rm migrate
moxie up -d bot
moxie run --rm bot node dist/deploy-commands.js
moxie logs --tail 100 bot
```

The migration does not alter existing guild, webhook, or Valheim records. Command registration adds four top-level commands and the `/moxie moderation` administrator group.

## Configure a guild

Place Moxie's role above every role it should be allowed to time out. Give the role **Moderate Members**. In the chosen log channel, Moxie needs **View Channel**, **Send Messages**, and **Embed Links**.

Run these commands as a server administrator:

```text
/moxie moderation configure channel:#moderation-log
/moxie module name:moderation enabled:true
/moxie moderation config
```

Test with a non-administrator moderator who has **Moderate Members**:

```text
/warn member:@TestMember reason:Test warning
/warnings member:@TestMember
/timeout member:@TestMember minutes:1 reason:Timeout test
/untimeout member:@TestMember reason:Test complete
```

Confirm that each response is visible only to the moderator, audit cards appear in the configured channel, warning history survives a bot-container restart, and a moderator cannot target an equal or higher role. Remove the setting with `/moxie moderation remove`; this retains warning history but prevents new warnings and timeout actions until a channel is configured again.
