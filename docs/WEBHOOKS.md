# Incoming webhooks

Authenticated JSON events become plain-text Discord notifications. Each route fixes one guild and text channel. Each route has a generated 256-bit Bearer token; PostgreSQL stores only its SHA-256 hash. Payloads cannot select a destination, mention policy, or bot command. Both the host HTTP listener and each guild's `webhooks` module default to disabled.

## Local setup

Keep the PostgreSQL SSH tunnel open. The route migration is applied to the current development database; new databases need `npm run db:migrate:deploy`.

Add these non-secret settings to local `.env`, then restart Moxie:

```env
WEBHOOK_ENABLED=true
WEBHOOK_HOST=127.0.0.1
WEBHOOK_PORT=3000
```

Health should show `Webhook API: Listening`. Choose another port from 1–65535 if needed. Invalid settings or a bind failure fail startup explicitly.

As a guild administrator, choose an existing server text channel:

```text
/webhook create name:monitor channel:#monitoring
/module name:webhooks enabled:true
/webhook list
```

Moxie needs View Channel and Send Messages. Guild/channel type and bot permissions are checked during creation and again before sending.

Creation returns `/webhooks/UUID` and `Authorization: Bearer TOKEN` privately. Save the token in the sender's credential storage; it cannot be retrieved later. Do not commit it, post it to chat, or put it in a URL. Listing exposes neither tokens nor hashes.

Test in Windows PowerShell. Enter the route path and **only the 64-character token**, without the Bearer prefix. The hidden prompt avoids a literal secret in shell history:

```powershell
$moxieWebhookPath = Read-Host 'Route path (/webhooks/...)'
$moxieWebhookToken = [System.Net.NetworkCredential]::new('', (Read-Host 'Webhook token' -AsSecureString)).Password
try {
    Invoke-RestMethod -Method Post `
        -Uri "http://127.0.0.1:3000$moxieWebhookPath" `
        -Headers @{ Authorization = "Bearer $moxieWebhookToken" } `
        -ContentType 'application/json' `
        -Body (@{ content = 'Moxie webhook test: service online' } | ConvertTo-Json)
} finally {
    Remove-Variable moxieWebhookToken
}
```

Success returns `{"status":"delivered"}` and posts `[monitor] Moxie webhook test: service online`. User/role/everyone mentions and automatic link embeds are suppressed.

## API contract

```http
POST /webhooks/UUID
Authorization: Bearer TOKEN
Content-Type: application/json

{"content":"Valheim server is online"}
```

For generic routes, only `content` is accepted: non-empty text, at most 1900 UTF-16 code units. Encoded JSON must fit within 8 KiB. Unknown fields, arrays, malformed JSON, compression, and query-string authentication are rejected. There is no GET or command-execution endpoint.

| Status | Meaning |
| --- | --- |
| 200 | Discord send completed |
| 400 | Invalid JSON/payload |
| 401 | Missing/malformed or incorrect route token |
| 403 | Guild module disabled or destination permissions missing |
| 404 | Unknown/deleted route or path |
| 405 | Use POST |
| 413 | Body exceeds 8 KiB |
| 415 | Use uncompressed application/json |
| 429 | Rate/concurrency limit; Retry-After is 60 seconds |
| 502 | Discord send failed |
| 503 | Storage, configuration, or Discord unavailable |

Limits are 60 authenticated delivery attempts per route per minute, 8 in-flight requests, 32 connections, and 1000 active in-memory rate windows. Windows expire after a minute and reset on restart. Request/header/socket timeouts bound slow clients.

There is no durable queue, automatic retry, replay protection, or idempotency store. Retrying a timeout/send failure may duplicate a message Discord already accepted. This milestone supports notifications rather than guaranteed event delivery.

Logs record outcomes and route/guild/channel IDs, omitting bodies, headers, tokens, hashes, and raw storage/delivery errors. Generated Bearer tokens are also redacted if accidentally included in a log message.

## Management

All route commands require guild Administrator permission and reply privately:

```text
/webhook list
/webhook rotate name:monitor
/webhook delete name:monitor
/module name:webhooks enabled:false
```

Names use 1–40 lowercase letters, digits, underscores, or hyphens and are unique per guild. Creation never replaces a route/token. Listing shows the first 10 routes, oldest first. Rotation shows a new token once and revokes the old token for subsequent checks. Deletion removes a route. Disabling the module retains routes, and admin diagnostics remain available.

Guild registration adds the disabled webhook-module default without resetting saved status choices. Route management stays available through the required admin module.

## Docker

Set `WEBHOOK_ENABLED=true` in `.env.docker`. Base Compose files set the container listener to `0.0.0.0:3000` but publish no port. For a reverse proxy on the VPS host, add the optional loopback-publication override:

```bash
docker compose --env-file .env.docker -f compose.yaml -f compose.webhooks.yaml --profile tools config --quiet
docker compose --env-file .env.docker -f compose.yaml -f compose.webhooks.yaml --profile tools build
docker compose --env-file .env.docker -f compose.yaml -f compose.webhooks.yaml run --rm migrate
docker compose --env-file .env.docker -f compose.yaml -f compose.webhooks.yaml up -d bot
```

For fresh PostgreSQL mode, substitute `compose.standalone.yaml`. Use the same file combination for updates/shutdown. `WEBHOOK_PORT` selects the host loopback port; the container port stays 3000.

The override binds to host `127.0.0.1`. Use an HTTPS reverse proxy for remote senders and forward Authorization; do not transmit Bearer tokens over public unencrypted HTTP. A proxy in Docker can instead join a shared network and reach the container directly. See [deployment details](DEPLOYMENT.md).

## Verification and next adapters

n8n can transform external events into this contract and store tokens as credentials. Uptime Kuma has a native route provider; see [Uptime Kuma setup](UPTIME_KUMA.md). Valheim and Mealie native adapters remain planned.

Automated tests cover authentication, scoped management, rotation, disabled modules, mentions, channel permissions, payload/body/rate/concurrency limits, failures, and shutdown. A real HTTP listener plus PostgreSQL transaction was tested with a stub Discord sender; test records were rolled back. Commands are registered in the test guild. The user also verified the local listener, an authenticated request returning delivered, and the real notification in the monitoring channel. Container runtime verification remains pending.
