# Moderation setup

Moxie provides guild-specific audit logging and a unified, durable case history for warnings, timeouts, timeout removals, kicks, and bans. The `moderation` module starts disabled in every guild.

## Behavior and permissions

- `/warn member reason` records a warning in PostgreSQL, sends an audit card, and returns its case ID.
- `/warnings member` privately shows the newest 10 warnings and the total count.
- `/cases member` privately shows the newest 10 cases across all action types.
- `/case id` privately shows one case, including reason-correction metadata.
- `/reason id reason` corrects a case reason without changing its case ID or original author/time.
- `/timeout member minutes reason` applies a Discord timeout for 1 minute through 28 days.
- `/untimeout member reason` removes an active timeout.
- `/kick member reason` removes a current member and records the successful action.
- `/ban member reason` bans a current member and records the successful action.
- Warning, history, case, reason, and timeout commands require **Moderate Members**. Kick requires **Kick Members**; ban requires **Ban Members**. Every response is private.
- A moderator cannot target themselves, bots, the server owner, or a member whose highest role is equal to or above theirs.
- Discord actions also require Moxie's highest role to be above the target and require Moxie to have the matching permission.
- Reasons are limited to 500 characters. Mentions in confirmations, history, and log cards are suppressed.

Cases remain stored if an administrator removes or changes the log-channel configuration. A case is not discarded when Discord temporarily rejects its audit-card delivery. Failed Discord actions do not create false cases. If an action succeeds but PostgreSQL becomes unavailable immediately afterward, Moxie explicitly reports that the action succeeded without a saved case.

Existing warning IDs and timestamps are preserved when upgrading: the migration renames the warning table into the unified case table and labels existing rows as warnings. Kicks and bans intentionally require a current guild member so Moxie can enforce role hierarchy; banning an arbitrary user ID and unbanning are outside this milestone.

## Deploy on forge01

The initial moderation release created `ModerationConfig` and `ModerationWarning`. This update migrates `ModerationWarning` in place to `ModerationCase`. Back up the Moxie database before applying it. In the existing VPS checkout:

```bash
moxie() { docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml "$@"; }
git pull --ff-only
moxie --profile tools build
moxie run --rm migrate
moxie up -d bot
moxie run --rm bot node dist/deploy-commands.js
moxie logs --tail 100 bot
```

The migration does not alter existing guild, webhook, or Valheim records. Command registration adds `/cases`, `/case`, `/reason`, `/kick`, and `/ban` while retaining all existing moderation commands.

## Configure a guild

Place Moxie's role above every role it should be allowed to moderate. Give the role **Moderate Members**, **Kick Members**, and **Ban Members**. In the chosen log channel, Moxie needs **View Channel**, **Send Messages**, and **Embed Links**.

Run these commands as a server administrator:

```text
/moderation configure channel:#moderation-log
/module name:moderation enabled:true
/moderation config
```

Test with a non-administrator moderator who has **Moderate Members**, **Kick Members**, and **Ban Members**:

```text
/warn member:@TestMember reason:Test warning
/warnings member:@TestMember
/timeout member:@TestMember minutes:1 reason:Timeout test
/untimeout member:@TestMember reason:Test complete
/cases member:@TestMember
/case id:CASE_ID_FROM_A_CONFIRMATION
/reason id:CASE_ID_FROM_A_CONFIRMATION reason:Corrected test reason
/kick member:@DisposableTestMember reason:Kick test
/ban member:@DisposableTestMember reason:Ban test
```

Use disposable accounts for kick/ban testing. Confirm that each response is visible only to the moderator, audit cards appear in the configured channel, combined history survives a bot-container restart, and a moderator cannot target an equal or higher role. Remove the setting with `/moderation remove`; this retains case history but prevents new actions and reason corrections until a channel is configured again.
