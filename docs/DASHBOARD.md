# First admin dashboard

The first dashboard slice provides Discord sign-in, a server picker, per-guild module toggles, and moderation log-channel setup. It uses the existing bot process and database. It is **disabled by default**, requires no migration, and does not open a host port in Docker. The Discord commands remain available.

The dashboard requests Discord OAuth scopes `identify` and `guilds`. On every selected-server page and setting change, it checks both the user's current OAuth guild list for Administrator permission and the bot's current guild membership data for that user's Administrator permission. POST forms require a session-specific CSRF token and the configured browser origin. Responses use `Referrer-Policy: same-origin` so browser form posts send the real `Origin` while referrers are withheld from other sites. Sessions and Discord access tokens stay in process memory for at most one hour and are lost on restart. The OAuth client secret stays in the environment file and must not be committed.

This flow follows [Discord's OAuth2 authorization-code and state guidance](https://discord.com/developers/docs/topics/oauth2). The dashboard does not currently include a case viewer, custom-command editor, or reaction-role editor.

## Local development

1. In the Discord Developer Portal for Moxie's application, add this exact OAuth2 redirect URL: `http://localhost:3005/callback`.
2. In your ignored local `.env`, set:

   ```env
   DASHBOARD_ENABLED=true
   DASHBOARD_CLIENT_SECRET=YOUR_DISCORD_OAUTH_CLIENT_SECRET
   DASHBOARD_BASE_URL=http://localhost:3005/
   DASHBOARD_HOST=127.0.0.1
   DASHBOARD_PORT=3005
   ```

3. Run the existing local bot and PostgreSQL connection, then open `http://localhost:3005/` in a browser. Sign in as a server Administrator. The server picker only shows guilds where both you and Moxie are present.
4. Try toggling a non-required module and confirm `/moxie modules` reflects the change. Configure a moderation log channel and confirm `/moxie moderation config` shows the same channel. Test that a non-administrator cannot open or change that server's settings.

## forge01 behind the existing reverse proxy

For this deployment, use `https://moxie.mcgeelabs.com/` as the dashboard base URL. The Nginx Proxy Manager host on `mcgee_proxy` should forward the root path to `moxie-bot` port `3005`, use a valid TLS certificate, and force HTTPS. Do not publish port 3005 to the public host.

In the Discord Developer Portal, register the exact redirect `https://moxie.mcgeelabs.com/callback`. In the ignored `.env.docker` on forge01 set:

```env
DASHBOARD_ENABLED=true
DASHBOARD_CLIENT_SECRET=YOUR_DISCORD_OAUTH_CLIENT_SECRET
DASHBOARD_BASE_URL=https://moxie.mcgeelabs.com/
```

Then use the existing deployment helper:

```bash
moxie() { docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml "$@"; }
git pull --ff-only
moxie build bot
moxie up -d bot
moxie logs --tail 100 bot
```

No database migration or slash-command redeployment is needed for this dashboard slice. The bot service already shares `mcgee_proxy` through `compose.integrations.yaml`; Nginx Proxy Manager can reach its `moxie-bot:3005` address privately. The dashboard's cookie is `Secure` when the configured URL uses HTTPS. Keep Nginx Proxy Manager as the only public entry point.

Do not put `/callback` in `DASHBOARD_BASE_URL`; Moxie adds that path when it starts OAuth. `compose.yaml` sets `DASHBOARD_HOST=0.0.0.0` inside the container so the reverse proxy can connect. A `DASHBOARD_HOST=127.0.0.1` line in `.env.docker` does not override this Compose value and can be removed.

If the dashboard does not start, check the safe startup log and the exact `DASHBOARD_BASE_URL` and Developer Portal redirect. Disabling it is one environment change: set `DASHBOARD_ENABLED=false` and recreate the bot container. Existing Discord commands and data continue to work.

Setting forms save the change and redirect back to the server page. That page rechecks current Discord Administrator access. Moxie retries one short Discord OAuth rate limit during that check; a remaining request failure logs the error type and upstream HTTP status without logging OAuth tokens.

The next dashboard slice can add read-only moderation case browsing. Custom commands and reaction-role editing will follow their respective bot modules.
