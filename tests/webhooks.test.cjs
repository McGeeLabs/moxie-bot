const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { request } = require('node:http');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { WebhookService, WebhookError, validateEvent } = require('../dist/integrations/webhooks/service');
const { WebhookServer } = require('../dist/integrations/webhooks/server');
const { DiscordWebhookDelivery } = require('../dist/integrations/webhooks/discordDelivery');
const { readWebhookConfig } = require('../dist/core/config');
const { execute: admin } = require('../dist/modules/admin/moxie');
const { logger } = require('../dist/core/logger');

function fixture() {
  const records = new Map();
  const sent = [];
  let enabled = true;
  let time = 1000;
  const database = { webhookRoute: {
    create: async args => {
      if ([...records.values()].some(row => row.guildId === args.data.guildId && row.name === args.data.name)) throw { code: 'P2002' };
      const row = { id: randomUUID(), ...args.data };
      records.set(row.id, row);
      return { id: row.id, name: row.name, channelId: row.channelId, provider: row.provider };
    },
    findUnique: async args => {
      if (args.where.id) return records.get(args.where.id) ?? null;
      const { guildId, name } = args.where.guildId_name;
      const row = [...records.values()].find(row => row.guildId === guildId && row.name === name);
      return row ? { id: row.id, name: row.name, channelId: row.channelId, provider: row.provider } : null;
    },
    findMany: async args => [...records.values()].filter(row => row.guildId === args.where.guildId)
      .slice(0, args.take).map(({ id, name, channelId, provider }) => ({ id, name, channelId, provider })),
    updateMany: async args => {
      let count = 0;
      for (const row of records.values()) if (row.guildId === args.where.guildId && row.name === args.where.name) { Object.assign(row, args.data); count++; }
      return { count };
    },
    deleteMany: async args => {
      let count = 0;
      for (const row of records.values()) if (row.guildId === args.where.guildId && row.name === args.where.name) { records.delete(row.id); count++; }
      return { count };
    },
  } };
  const configuration = { ensureGuild: async () => {}, isEnabled: async (guildId, module) => { assert.ok(['webhooks', 'uptimeKuma'].includes(module)); return enabled; } };
  const delivery = { validateDestination: async () => {}, send: async (...args) => { sent.push(args); } };
  const service = new WebhookService(delivery, () => database, configuration, () => time);
  return { service, records, sent, setEnabled: value => { enabled = value; }, advance: () => { time += 60000; } };
}

function httpCall(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'POST', headers: options.headers ?? {} }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    if (options.chunks) for (const chunk of options.chunks) req.write(chunk);
    req.end(options.body);
  });
}

const errorStatus = status => error => error instanceof WebhookError && error.status === status;

test('listener config is off by default, loopback by default when enabled, and validates ports', () => {
  assert.equal(readWebhookConfig({}), undefined);
  assert.deepEqual(readWebhookConfig({ WEBHOOK_ENABLED: 'true' }), { host: '127.0.0.1', port: 3000 });
  for (const port of ['0', '65536', '12.5', 'abc']) assert.throws(() => readWebhookConfig({ WEBHOOK_ENABLED: 'true', WEBHOOK_PORT: port }), /WEBHOOK_PORT/);
  assert.throws(() => readWebhookConfig({ WEBHOOK_ENABLED: 'yes' }), /WEBHOOK_ENABLED/);
});

test('payload validation rejects destination overrides, embeds, empty content, and long text', () => {
  assert.deepEqual(validateEvent({ content: 'Server online' }), { content: 'Server online' });
  for (const value of [null, [], 'text', {}, { content: ' ' }, { content: 42 }, { content: 'x'.repeat(1901) }, { content: 'ok', guildId: 'other' }, { content: 'ok', channelId: 'other' }, { content: 'ok', embeds: [] }]) assert.throws(() => validateEvent(value), errorStatus(400));
});

test('per-route secrets are hashed and rotate; management operations are guild scoped', async () => {
  const f = fixture();
  const a = await f.service.createRoute('guild-a', 'monitor', 'channel-a');
  const b = await f.service.createRoute('guild-b', 'monitor', 'channel-b');
  assert.notEqual(a.token, b.token);
  assert.equal(f.records.get(a.id).secretHash, createHash('sha256').update(a.token).digest('hex'));
  assert.ok(!JSON.stringify([...f.records.values()]).includes(a.token));
  await assert.rejects(() => f.service.dispatch(a.id, b.token, { content: 'x' }), errorStatus(401));
  await assert.rejects(() => f.service.rotateSecret('guild-c', 'monitor'), errorStatus(404));
  const rotated = await f.service.rotateSecret('guild-a', 'monitor');
  await assert.rejects(() => f.service.dispatch(a.id, a.token, { content: 'x' }), errorStatus(401));
  await f.service.dispatch(a.id, rotated.token, { content: 'online' });
  assert.deepEqual(f.sent[0], ['guild-a', 'channel-a', '[monitor] online']);
  const listed = await f.service.listRoutes('guild-a');
  assert.deepEqual(listed, [{ id: a.id, name: 'monitor', channelId: 'channel-a', provider: 'generic' }]);
  assert.ok(!JSON.stringify(listed).includes('secretHash'));
  await f.service.deleteRoute('guild-a', 'monitor');
  await assert.rejects(() => f.service.dispatch(a.id, rotated.token, { content: 'x' }), errorStatus(404));
  await f.service.dispatch(b.id, b.token, { content: 'still online' });
});

test('routes reject invalid names and duplicate names without changing the original secret', async () => {
  const f = fixture();
  for (const name of ['Uppercase', 'space name', '', 'x'.repeat(41), '@everyone']) await assert.rejects(() => f.service.createRoute('guild-a', name, 'channel'), errorStatus(400));
  const route = await f.service.createRoute('guild-a', 'monitor', 'channel');
  await assert.rejects(() => f.service.createRoute('guild-a', 'monitor', 'other'), errorStatus(409));
  await f.service.dispatch(route.id, route.token, { content: 'ok' });
});

test('disabled modules stop delivery and authenticated routes have a bounded rate window', async t => {
  t.mock.method(logger, 'info', () => {});
  const f = fixture();
  const route = await f.service.createRoute('guild-a', 'monitor', 'channel');
  f.setEnabled(false);
  await assert.rejects(() => f.service.dispatch(route.id, route.token, { content: 'x' }), errorStatus(403));
  assert.equal(f.sent.length, 0);
  f.setEnabled(true);
  for (let i = 0; i < 60; i++) await f.service.dispatch(route.id, route.token, { content: 'x' });
  await assert.rejects(() => f.service.dispatch(route.id, route.token, { content: 'x' }), errorStatus(429));
  f.advance();
  await f.service.dispatch(route.id, route.token, { content: 'x' });
  assert.equal(f.sent.length, 61);
});

test('storage failures are sanitized and do not call delivery', async () => {
  const service = new WebhookService({ validateDestination: async () => {}, send: async () => assert.fail('must not send') }, () => { throw new Error('postgresql://secret'); });
  await assert.rejects(() => service.dispatch(randomUUID(), 'a'.repeat(64), { content: 'x' }), error => errorStatus(503)(error) && !error.message.includes('postgresql://secret'));
});

test('Discord destinations require a same-guild text channel and explicit bot permissions', async () => {
  const sent = [];
  let allowed = true;
  let channelGuild = 'guild-a';
  let type = ChannelType.GuildText;
  const channel = { get guildId() { return channelGuild; }, get type() { return type; },
    permissionsFor: () => ({ has: permissions => { assert.deepEqual(permissions, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]); return allowed; } }),
    send: async value => sent.push(value),
  };
  const client = { isReady: () => true, guilds: { fetch: async () => ({ channels: { fetch: async () => channel }, members: { me: {} } }) } };
  const delivery = new DiscordWebhookDelivery(client);
  await delivery.send('guild-a', 'channel', '@everyone <@123> https://example.com');
  assert.deepEqual(sent[0].allowedMentions, { parse: [], repliedUser: false });
  allowed = false;
  await assert.rejects(() => delivery.send('guild-a', 'channel', 'x'), errorStatus(403));
  allowed = true; channelGuild = 'guild-b';
  await assert.rejects(() => delivery.send('guild-a', 'channel', 'x'), errorStatus(400));
  channelGuild = 'guild-a'; type = ChannelType.GuildVoice;
  await assert.rejects(() => delivery.send('guild-a', 'channel', 'x'), errorStatus(400));
  assert.equal(sent.length, 1);
});

test('webhook admin commands reject non-administrators before touching route storage', async () => {
  let accessed = false;
  const calls = [];
  await admin({ inGuild: () => true, memberPermissions: { has: () => false },
    options: { getSubcommandGroup: () => { accessed = true; return 'webhook'; } },
    reply: async value => calls.push(value),
  });
  assert.equal(accessed, false);
  assert.match(calls[0].content, /Administrator/);
});

test('HTTP boundary validates methods, auth, content type, JSON, and body limits', async t => {
  let calls = 0;
  const server = new WebhookServer({ host: '127.0.0.1', port: 0 }, { dispatch: async (id, token, payload) => { validateEvent(payload); calls++; } });
  const port = await server.start();
  t.after(() => server.stop());
  const path = `/webhooks/${randomUUID()}`;
  const headers = { Authorization: `Bearer ${'a'.repeat(64)}`, 'Content-Type': 'application/json' };
  assert.equal((await httpCall(port, '/unknown')).status, 404);
  assert.equal((await httpCall(port, path, { method: 'GET' })).status, 405);
  assert.equal((await httpCall(port, path)).status, 401);
  assert.equal((await httpCall(port, path, { headers: { Authorization: headers.Authorization } })).status, 415);
  assert.equal((await httpCall(port, path, { headers, body: '{' })).status, 400);
  assert.equal((await httpCall(port, path, { headers, body: JSON.stringify({ content: 'ok', channelId: 'override' }) })).status, 400);
  assert.equal((await httpCall(port, path, { headers: { ...headers, 'Content-Length': '9000' } })).status, 413);
  assert.equal((await httpCall(port, path, { headers, chunks: ['x'.repeat(5000), 'x'.repeat(5000)] })).status, 413);
  const result = await httpCall(port, path, { headers, body: JSON.stringify({ content: 'ok' }) });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'delivered');
  assert.equal(calls, 1);
});

test('HTTP service failures use sanitized responses with retry headers', async t => {
  let error = new WebhookError(429, 'Rate limit exceeded');
  const server = new WebhookServer({ host: '127.0.0.1', port: 0 }, { dispatch: async () => { throw error; } });
  const port = await server.start();
  t.after(() => server.stop());
  const options = { headers: { Authorization: `Bearer ${'a'.repeat(64)}`, 'Content-Type': 'application/json' }, body: '{"content":"ok"}' };
  const result = await httpCall(port, `/webhooks/${randomUUID()}`, options);
  assert.equal(result.status, 429);
  assert.equal(result.headers['retry-after'], '60');
  error = new Error('secret-raw-error');
  const unavailable = await httpCall(port, `/webhooks/${randomUUID()}`, options);
  assert.equal(unavailable.status, 503);
  assert.ok(!JSON.stringify(unavailable).includes('secret-raw-error'));
});

test('logs redact generated webhook Bearer tokens', () => {
  const previous = console.warn;
  let output;
  try {
    console.warn = value => { output = value; };
    logger.warn(`Authorization: Bearer ${'a'.repeat(64)}`);
    assert.ok(!output.includes('a'.repeat(64)));
    assert.match(output, /REDACTED/);
  } finally { console.warn = previous; }
});

test('webhook creation through /moxie returns the token privately and binds this guild', async () => {
  const f = fixture();
  const calls = [];
  await admin({
    inGuild: () => true, guildId: 'guild-a', memberPermissions: { has: () => true }, user: { id: 'admin' },
    client: { webhooks: f.service },
    options: { getSubcommandGroup: () => 'webhook', getSubcommand: () => 'create', getString: name => name === 'provider' ? null : 'monitor', getChannel: () => ({ id: 'channel-a' }) },
    deferReply: async value => calls.push(['defer', value]), editReply: async value => calls.push(['edit', value]),
  });
  assert.equal(calls[0][1].flags, 64);
  assert.match(calls[1][1].content, /Authorization: Bearer [0-9a-f]{64}/);
  assert.match(calls[1][1].content, /Save this token now/);
  const row = [...f.records.values()][0];
  assert.equal(row.guildId, 'guild-a');
  assert.equal(row.channelId, 'channel-a');
  assert.equal(f.sent.length, 0);
});

test('HTTP server rejects excess concurrent deliveries and drains active requests', { timeout: 5000 }, async t => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let reached;
  const ready = new Promise(resolve => { reached = resolve; });
  let count = 0;
  const server = new WebhookServer({ host: '127.0.0.1', port: 0 }, { dispatch: async () => {
    if (++count === 8) reached();
    await blocked;
  } });
  const port = await server.start();
  const options = { headers: { Authorization: `Bearer ${'a'.repeat(64)}`, 'Content-Type': 'application/json' }, body: '{"content":"ok"}' };
  const path = `/webhooks/${randomUUID()}`;
  const pending = Promise.all(Array.from({ length: 8 }, () => httpCall(port, path, options)));
  t.after(async () => { release(); await pending; await server.stop(); });
  await ready;
  assert.equal((await httpCall(port, path, options)).status, 429);
  release();
  assert.ok((await pending).every(result => result.status === 200));
});

test('shutdown during listener startup closes the eventual listening socket', async () => {
  const server = new WebhookServer({ host: '127.0.0.1', port: 0 }, { dispatch: async () => {} });
  const starting = server.start();
  const stopping = server.stop();
  await Promise.all([starting, stopping]);
  assert.equal(server.isListening(), false);
});
