# Uptime Kuma notifications

Moxie accepts Uptime Kuma's native JSON webhook notifications. This is a push adapter: Kuma checks services and Moxie delivers its notifications. Moxie does not log into Kuma, poll its API, or claim a live connection in health diagnostics.

The payload and Additional Headers settings were checked against the [Uptime Kuma 1.23.17 webhook implementation](https://github.com/louislam/uptime-kuma/blob/1.23.17/server/notification-providers/webhook.js). The user confirmed a live test notification from forge01 arrived in Discord through the Docker relay, reverse SSH tunnel, and Windows development bot after adding the narrow UFW rule. A real DOWN alert for the Automation monitor was also confirmed after a deliberate invalid-hostname change. UP recovery remains to be verified.

## Create a destination

After updating Moxie, applying migrations, and deploying commands, restart the bot. As a Discord server administrator:

1. Run `/moxie webhook create name:kuma channel:#monitoring provider:Uptime Kuma`.
2. Save the private token shown once. Existing generic routes remain generic; create a separate route for Kuma.
3. Run `/moxie module name:webhooks enabled:true`.
4. Run `/moxie module name:uptimeKuma enabled:true`.

Both toggles apply only to this Discord server. Disabling either stops Kuma delivery. The `uptimeKuma` module starts disabled. Route listing includes the provider; rotation and deletion use the existing webhook commands.

If Discord says the command is outdated or only shows `name` and `channel`, clear the unfinished command and reload Discord (Ctrl+R in the Windows desktop app). Start a fresh `/moxie webhook create`, then select the optional `provider` field from Discord's option picker and choose **Uptime Kuma**. Command deployment updates Discord's registration; the client may still display a cached definition until refreshed. Omitting `provider` creates a Generic route, which cannot accept native Kuma payloads.

## Configure Kuma 1.23.17

In **Settings → Notifications → Setup Notification**, choose **Webhook**:

- Friendly name: `Moxie monitoring`.
- Post URL: `http://REACHABLE_MOXIE_HOST:3000/webhooks/ROUTE_ID`, using the exact path returned by Discord. Use HTTPS when crossing an untrusted network.
- Request Body: **JSON** (the native preset), not form-data.
- Additional Headers: the following JSON with your actual token:

```json
{"Authorization":"Bearer YOUR_ROUTE_TOKEN"}
```

Use **Test** after connectivity is established, save the notification, and enable it on the relevant monitors. A successful request returns `{"status":"delivered"}`. Kuma tests and notifications without heartbeat data show as general notifications. Status events include the monitor name, status, optional latency/time, and a bounded description.

## Notification appearance

Kuma notifications now use Discord embeds: green for UP, red for DOWN, amber for PENDING, purple for MAINTENANCE, and blue for general/test notifications. Cards have a short title, description, monitor/status fields, optional latency/reported UTC time, and a footer identifying Moxie, Kuma, and the saved route name. No database migration or command redeployment is required for this presentation change. Existing messages keep their old appearance; new messages use cards after the bot image is rebuilt.

Moxie needs **Embed Links**, as well as View Channel and Send Messages, in the notification channel. Missing Embed Links is reported as HTTP 403 before sending. Generic webhook routes continue to send plain text with automatic link embeds suppressed. The external webhook API does not accept arbitrary embeds; Kuma cards are constructed by the adapter from validated fields.

Direct Kuma test delivery over forge01's Docker network is confirmed by the user. The new card formatting is covered by local tests; live card delivery after deployment remains to be verified.

## forge01 to a Windows development bot

Your current PostgreSQL tunnel forwards traffic from Windows to forge01. It does not allow Kuma on forge01 to reach the Windows webhook listener. Keep Moxie's listener on `127.0.0.1`; setting Kuma's URL to `localhost:3000` would target Kuma's container, not your PC.

A reverse SSH tunnel can forward a VPS loopback port back to the PC:

```powershell
ssh -N -o ExitOnForwardFailure=yes -R 127.0.0.1:3001:127.0.0.1:3000 forge01
```

This makes Moxie reachable at `127.0.0.1:3001` **on the VPS host**. A bridge-networked Kuma container still cannot reach that host-loopback address. Before choosing a container-accessible relay or private proxy, inspect Kuma's container name and network mode on forge01:

```bash
docker ps --format '{{.Names}}  {{.Image}}'
docker inspect --format '{{.HostConfig.NetworkMode}}' YOUR_KUMA_CONTAINER
```

Your container is `mcgee-uptime-kuma` on the `mcgee_proxy` bridge network. In a separate forge01 shell, find that network's gateway and run a temporary relay bound specifically to it:

```bash
moxie_gateway=$(docker network inspect --format '{{(index .IPAM.Config 0).Gateway}}' mcgee_proxy)
test -n "$moxie_gateway" || exit 1
printf 'Docker gateway: %s\n' "$moxie_gateway"
docker run --rm --name moxie-dev-relay --network host \
  -e RELAY_BIND="$moxie_gateway" alpine:3.22 \
  sh -c 'apk add --no-cache socat && exec socat TCP-LISTEN:3002,bind="$RELAY_BIND",reuseaddr,fork TCP:127.0.0.1:3001'
```

Keep the reverse tunnel, relay, and local bot running. Use `http://DOCKER_GATEWAY:3002/webhooks/ROUTE_ID` as Kuma's Post URL, substituting the printed gateway. The path is Kuma → Docker gateway relay → VPS loopback tunnel → Windows Moxie. The relay binds to the Docker bridge gateway, not the public VPS interface. Other containers able to reach that gateway can access the listener; route authentication remains required. The container downloads Alpine and installs socat temporarily, without a data volume or restart policy.

Stop the relay with Ctrl+C (or `docker stop moxie-dev-relay` from another shell), then stop the reverse tunnel after testing. These commands have not been executed on the VPS by this milestone. They do not change Kuma's container, existing proxy configuration, or SSH server settings.

### Host firewall during the development test

If a host-side request to the relay returns HTTP 404 but Kuma times out, check the host firewall. On forge01, Kuma currently has IP `172.18.0.4` and the Docker gateway is `172.18.0.1`. UFW is active with incoming traffic denied by default. A narrow development rule allows this container to reach this relay:

```bash
sudo ufw allow in proto tcp from 172.18.0.4 to 172.18.0.1 port 3002
```

Retry Kuma's Test button after adding the rule. This rule is persistent until removed; remove it when retiring the development relay:

```bash
sudo ufw delete allow in proto tcp from 172.18.0.4 to 172.18.0.1 port 3002
```

Container IPs can change when containers are recreated. Verify current addresses before reusing the rule. This targets a host listener, so it uses an incoming rule rather than a routed rule. See the [UFW manual](https://manpages.ubuntu.com/manpages/focal/man8/ufw.8.html) for source/destination-specific syntax. Adding this rule resolved the timeout and live test delivery was confirmed by the user.

For eventual VPS deployment, run Moxie and Kuma on a shared Docker network and use Moxie's service name and internal port. Enable Moxie's listener inside its container with `WEBHOOK_HOST=0.0.0.0`. No public port is needed for container-to-container notifications. See [deployment](DEPLOYMENT.md).

## Boundaries

- Authentication, same-guild channel permissions, mention suppression, timeouts, and rate/concurrency limits remain shared with [generic webhooks](WEBHOOKS.md).
- JSON bodies are limited to 8 KiB, including native monitor metadata. Large monitor configurations may receive HTTP 413.
- Only display fields are used; monitor passwords, headers, URLs, and other configuration are not copied into Discord. URL credentials/query strings and bearer tokens in description text are stripped, but descriptions should still avoid sensitive information.
- No queue, retries, event history, or deduplication is added. A successful response means Discord delivery completed; upstream retries may duplicate messages.
- DOWN/UP/PENDING/MAINTENANCE use Kuma status values 0/1/2/3. Unsupported values or malformed payloads receive HTTP 400.
- Provider choice is fixed when creating a route; existing routes retain their generic payload contract.
