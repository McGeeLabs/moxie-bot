const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { readDashboardConfig } = require('../dist/core/config');
const { isGuildAdministrator, DiscordOAuth, DiscordOAuthError } = require('../dist/dashboard/oauth');
const { DashboardServer } = require('../dist/dashboard/server');

const guildId = '123456789012345678';
const userId = '223456789012345678';
const channelId = '323456789012345678';

function fixture() {
  const config = { clientId: '423456789012345678', clientSecret: 'private-test-secret', baseUrl: new URL('http://localhost/'), host: '127.0.0.1', port: 0 };
  let administrator = true;
  let guildAccess = true;
  const oauth = {
    authorizationUrl: state => `https://discord.com/oauth2/authorize?state=${state}`,
    exchange: async code => { assert.equal(code, 'test-code'); return { accessToken: 'test-token', expiresIn: 3600 }; },
    identity: async () => ({ id: userId, username: '<Admin & Tester>' }),
    guilds: async () => [{ id: guildId, name: '<My & Guild>', owner: false,
      permissions: guildAccess ? String(PermissionFlagsBits.Administrator) : '0' }],
  };
  const member = { permissions: { has: permission => administrator && permission === PermissionFlagsBits.Administrator } };
  const channel = { id: channelId, name: 'staff <logs>', type: ChannelType.GuildText,
    permissionsFor: () => ({ has: () => true }) };
  const guild = { id: guildId, name: '<My & Guild>', members: { fetch: async () => member, fetchMe: async () => member, me: member },
    channels: { fetch: async () => new Map([[channelId, channel]]) } };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } };
  const changes = [];
  const configuration = {
    listModules: async () => [{ name: 'admin', enabled: true, required: true }, { name: 'moderation', enabled: false, required: false }],
    setEnabled: async (...args) => changes.push(['module', ...args]),
  };
  const moderation = { getConfig: async () => null, configure: async (...args) => changes.push(['channel', ...args]),
    removeConfig: async (...args) => changes.push(['remove', ...args]) };
  const destination = { validateDestination: async (...args) => changes.push(['validate', ...args]) };
  const dashboard = new DashboardServer(config, client, oauth, configuration, moderation, destination);
  return { dashboard, changes, revokeAdministrator: () => { administrator = false; }, revokeGuildAccess: () => { guildAccess = false; } };
}

function cookieValue(response, name) {
  return response.headers.get('set-cookie')?.match(new RegExp(`${name}=([^;]+)`))?.[1];
}

async function login(base) {
  const start = await fetch(`${base}/login`, { redirect: 'manual' });
  assert.equal(start.status, 303);
  const state = cookieValue(start, 'moxie_oauth');
  assert.match(start.headers.get('location'), /discord.com\/oauth2\/authorize/);
  const callback = await fetch(`${base}/callback?code=test-code&state=${state}`, {
    headers: { cookie: `moxie_oauth=${state}` }, redirect: 'manual',
  });
  assert.equal(callback.status, 303);
  return cookieValue(callback, 'moxie_session');
}

test('dashboard stays off by default and requires a valid callback URL and secret when enabled', () => {
  assert.equal(readDashboardConfig({}), undefined);
  assert.throws(() => readDashboardConfig({ DASHBOARD_ENABLED: 'true' }), /DISCORD_CLIENT_ID/);
  const input = { DASHBOARD_ENABLED: 'true', DISCORD_CLIENT_ID: '423456789012345678', DASHBOARD_CLIENT_SECRET: 'secret',
    DASHBOARD_BASE_URL: 'https://moxie.example.com/' };
  assert.equal(readDashboardConfig(input).port, 3005);
  assert.throws(() => readDashboardConfig({ ...input, DASHBOARD_BASE_URL: 'http://example.com/' }), /HTTPS origin/);
  assert.throws(() => readDashboardConfig({ ...input, DASHBOARD_BASE_URL: 'https://example.com/path' }), /HTTPS origin/);
});

test('OAuth uses a state value, form encoded exchange, and identifies admin guilds', async () => {
  const config = { clientId: '423456789012345678', clientSecret: 'private-test-secret', baseUrl: new URL('https://moxie.example.com/') };
  const calls = [];
  const oauth = new DiscordOAuth(config, async (url, options) => {
    calls.push([url, options]); return { ok: true, json: async () => ({ access_token: 'token', expires_in: 3600 }) };
  });
  const url = new URL(oauth.authorizationUrl('random-state'));
  assert.equal(url.searchParams.get('scope'), 'identify guilds');
  assert.equal(url.searchParams.get('state'), 'random-state');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://moxie.example.com/callback');
  assert.deepEqual(await oauth.exchange('code'), { accessToken: 'token', expiresIn: 3600 });
  assert.equal(calls[0][1].body.get('client_secret'), 'private-test-secret');
  assert.equal(calls[0][1].headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(isGuildAdministrator({ owner: false, permissions: String(PermissionFlagsBits.Administrator) }), true);
  assert.equal(isGuildAdministrator({ owner: false, permissions: '0' }), false);
});

test('OAuth guild lookup retries a Discord rate limit once and reports other failures safely', async () => {
  const config = { clientId: '423456789012345678', clientSecret: 'private-test-secret', baseUrl: new URL('https://moxie.example.com/') };
  let calls = 0;
  const oauth = new DiscordOAuth(config, async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }) };
    return { ok: true, json: async () => [{ id: guildId, name: 'Server', owner: true, permissions: '0' }] };
  });
  assert.equal((await oauth.guilds('secret-access-token')).length, 1);
  assert.equal(calls, 2);
  const denied = new DiscordOAuth(config, async () => ({ ok: false, status: 403 }));
  await assert.rejects(denied.guilds('secret-access-token'), error =>
    error instanceof DiscordOAuthError && error.status === 403 && !error.message.includes('secret-access-token'));
});

test('dashboard requires matching OAuth state and protects settings with fresh admin rights and CSRF', async () => {
  const f = fixture(); await f.dashboard.start();
  const base = `http://127.0.0.1:${f.dashboard.server.address().port}`;
  try {
    const failed = await fetch(`${base}/callback?code=test-code&state=invalid`, { redirect: 'manual' });
    assert.equal(failed.status, 403);
    const session = await login(base);
    const home = await fetch(base, { headers: { cookie: `moxie_session=${session}` } });
    const homeHtml = await home.text();
    assert.match(homeHtml, /&lt;My &amp; Guild&gt;/);
    assert.doesNotMatch(homeHtml, /<My & Guild>/);
    assert.match(homeHtml, /<a class="brand" href="\/" aria-label="Moxie dashboard home">/);
    assert.equal(home.headers.get('referrer-policy'), 'same-origin');
    assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const panel = await fetch(`${base}/guild/${guildId}`, { headers: { cookie: `moxie_session=${session}` } });
    const html = await panel.text();
    assert.equal(panel.status, 200);
    assert.match(html, /moderation/);
    const csrf = html.match(/name=csrf value="([a-f0-9]+)"/)[1];
    const post = (path, body, origin = 'http://localhost') => fetch(`${base}${path}`, { method: 'POST', redirect: 'manual',
      headers: { cookie: `moxie_session=${session}`, origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    assert.equal((await post(`/guild/${guildId}/module`, { csrf: 'invalid', name: 'moderation', enabled: 'true' })).status, 403);
    assert.equal((await post(`/guild/${guildId}/module`, { csrf, name: 'moderation', enabled: 'true' }, 'http://evil.example')).status, 403);
    assert.equal((await post(`/guild/${guildId}/module`, { csrf, name: 'moderation', enabled: 'true' }, 'null')).status, 403);
    assert.equal((await post(`/guild/${guildId}/module`, { csrf, name: 'admin', enabled: 'false' })).status, 400);
    assert.deepEqual(f.changes, []);
    const update = await post(`/guild/${guildId}/module`, { csrf, name: 'moderation', enabled: 'true' });
    assert.equal(update.status, 303);
    assert.deepEqual(f.changes[0], ['module', guildId, 'moderation', true]);
    const channel = await post(`/guild/${guildId}/log-channel`, { csrf, channel: channelId });
    assert.equal(channel.status, 303);
    assert.deepEqual(f.changes.slice(1), [['validate', guildId, channelId, true], ['channel', guildId, channelId]]);
    f.revokeAdministrator();
    assert.equal((await post(`/guild/${guildId}/module`, { csrf, name: 'moderation', enabled: 'false' })).status, 403);
    assert.equal(f.changes.length, 3);
    f.revokeGuildAccess();
    assert.equal((await fetch(`${base}/guild/${guildId}`, { headers: { cookie: `moxie_session=${session}` } })).status, 403);
  } finally { await f.dashboard.stop(); }
});
