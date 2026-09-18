const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSocket } = require('node:dgram');
const { parseInfo, queryValheim } = require('../dist/integrations/valheim/query');
const { ValheimService, ValheimError, normalizeHost } = require('../dist/modules/valheim/service');
const { ConfigurationUnavailableError } = require('../dist/core/database/guildConfiguration');
const { statusEmbed, execute } = require('../dist/modules/valheim/commands');
const { execute: admin } = require('../dist/modules/admin/moxie');

function packet(folder = 'valheim') {
  const string = value => Buffer.from(value + '\0');
  return Buffer.concat([Buffer.from([255,255,255,255,73,17]), string('Test *server*'), string('World'), string(folder), string('Valheim'),
    Buffer.from([0,0,2,10,0,100,108,1,0]), string('1.0.0.0'), Buffer.from([32]), string('g=0.221.5,n=1')]);
}

async function udp(t, receive) {
  const socket = createSocket('udp4');
  t.after(() => new Promise(resolve => socket.close(resolve)));
  socket.on('message', (value, peer) => receive(value, reply => socket.send(reply, peer.port, peer.address)));
  await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
  return socket.address().port;
}

function fixture(query = async () => ({ ...parseInfo(packet()), latencyMs: 25 })) {
  const rows = new Map();
  const enabled = new Set(['guild-a', 'guild-b']);
  let time = 1000;
  const database = { valheimServerConfig: {
    upsert: async args => { rows.set(args.where.guildId, { ...(rows.get(args.where.guildId) ?? args.create), ...args.update }); },
    findUnique: async args => rows.get(args.where.guildId) ?? null,
    deleteMany: async args => { rows.delete(args.where.guildId); },
  } };
  const configuration = { ensureGuild: async () => {}, isEnabled: async (guildId, module) => {
    assert.equal(module, 'valheim'); return enabled.has(guildId);
  } };
  const service = new ValheimService(() => database, configuration, query, () => time);
  const configure = (guildId = 'guild-a', host = 'valheim.example.com') => service.configure({ guildId, host, gamePort: 10470, queryPort: 10471, channelId: `channel-${guildId}` });
  return { service, rows, enabled, configure, advance: () => { time += 15001; } };
}

test('A2S parses reported players, password flag, and actual version tag; rejects truncated packets', () => {
  const result = parseInfo(packet());
  assert.equal(result.players, 2);
  assert.equal(result.maxPlayers, 10);
  assert.equal(result.passwordProtected, true);
  assert.equal(result.version, '0.221.5');
  for (const size of [0, 4, 6, 12, packet().length - 1]) assert.throws(() => parseInfo(packet().subarray(0, size)));
});

test('UDP query handles a real A2S challenge exchange using the configured port', async t => {
  const challenge = Buffer.from([1,2,3,4]);
  let requests = 0;
  const port = await udp(t, (request, reply) => {
    assert.equal(request[4], 84);
    assert.equal(request.subarray(5,25).toString(), 'Source Engine Query\0');
    if (++requests === 1) reply(Buffer.concat([Buffer.from([255,255,255,255,65]), challenge]));
    else { assert.deepEqual(request.subarray(25), challenge); reply(packet()); }
  });
  const result = await queryValheim('127.0.0.1', port, 1000);
  assert.equal(result.status, 'online');
  assert.equal(requests, 2);
  assert.ok(result.latencyMs >= 0);
});

test('UDP timeout is bounded and is reported as query unavailable', async t => {
  const port = await udp(t, () => {});
  assert.deepEqual(await queryValheim('127.0.0.1', port, 100), { status: 'unavailable', reason: 'timeout' });
});

test('UDP refuses malformed, split, and non-Valheim replies without marking them online', async t => {
  for (const [reply, reason] of [[Buffer.alloc(2), 'invalid_response'], [Buffer.from([254,255,255,255,0]), 'unsupported_response'], [packet('other-game'), 'wrong_game']]) {
    const port = await udp(t, (value, send) => send(reply));
    assert.deepEqual(await queryValheim('127.0.0.1', port, 1000), { status: 'unavailable', reason });
  }
});

test('challenge loops terminate rather than sending unlimited packets', async t => {
  let requests = 0;
  const port = await udp(t, (value, send) => { requests++; send(Buffer.from([255,255,255,255,65,1,2,3,4])); });
  assert.equal((await queryValheim('127.0.0.1', port, 1000)).reason, 'invalid_response');
  assert.equal(requests, 3);
});

test('hosts exclude URLs, credentials and ports; game/query ports are independently validated', async () => {
  assert.equal(normalizeHost(' Valheim.Example.Com. '), 'valheim.example.com');
  assert.equal(normalizeHost('85.190.156.180'), '85.190.156.180');
  for (const host of ['', 'https://example.com', 'example.com:10470', 'user:password@example.com', '-bad.example', 'bad/path']) {
    assert.throws(() => normalizeHost(host), ValheimError);
  }
  const f = fixture();
  await assert.rejects(() => f.service.configure({ guildId: 'guild-a', host: 'valid.example', gamePort: 10470, queryPort: 65536, channelId: 'channel' }), ValheimError);
  assert.equal(f.rows.size, 0);
});

test('Valheim configurations are guild scoped, use the query port, and cache checks briefly', async () => {
  const calls = [];
  const f = fixture(async (host, port) => { calls.push([host, port]); return { ...parseInfo(packet()), latencyMs: 25 }; });
  await f.configure();
  await f.configure('guild-b', 'another.example');
  await f.service.status('guild-a');
  await f.service.status('guild-a');
  assert.deepEqual(calls, [['valheim.example.com', 10471]]);
  f.advance();
  await f.service.status('guild-a');
  assert.equal(calls.length, 2);
  await f.service.remove('guild-a');
  assert.equal(await f.service.getConfig('guild-a'), null);
  assert.equal((await f.service.getConfig('guild-b')).host, 'another.example');
});

test('module checks happen before cached status delivery; missing configuration produces a setup message', async () => {
  let queries = 0;
  const f = fixture(async () => { queries++; return { ...parseInfo(packet()), latencyMs: 1 }; });
  await assert.rejects(() => f.service.status('guild-a'), /No Valheim server configured/);
  await f.configure();
  await f.service.status('guild-a');
  f.enabled.delete('guild-a');
  await assert.rejects(() => f.service.status('guild-a'), /disabled/);
  assert.equal(queries, 1);
});

test('storage failures are sanitized and do not start a network query', async () => {
  const service = new ValheimService(() => { throw new Error('postgresql://secret'); }, { isEnabled: async () => true }, () => assert.fail('must not query'));
  await assert.rejects(() => service.status('guild-a'), error => error instanceof ConfigurationUnavailableError && !error.message.includes('secret'));
});

test('Valheim admin dispatch rejects non-administrators before accessing options or storage', async () => {
  let accessed = false;
  await admin({ inGuild: () => true, memberPermissions: { has: () => false },
    options: { getSubcommandGroup: () => { accessed = true; return 'valheim'; } }, reply: async () => {} });
  assert.equal(accessed, false);
});

test('configuration command binds this guild and validates its channel; replies are private', async () => {
  const f = fixture();
  const calls = [];
  await execute({ guildId: 'guild-a', client: {}, user: { id: 'admin' },
    options: { getSubcommand: () => 'configure', getString: () => 'valheim.example.com',
      getInteger: name => name === 'game-port' ? 10470 : null, getChannel: () => ({ id: 'channel-a' }) },
    deferReply: async value => calls.push(value), editReply: async value => calls.push(value),
  }, f.service, { validateDestination: async (guildId, channelId) => {
    assert.equal(guildId, 'guild-a'); assert.equal(channelId, 'channel-a');
  } });
  assert.equal(calls[0].flags, 64);
  assert.equal((await f.service.getConfig('guild-a')).queryPort, 10471);
});

test('status cards escape server text and distinguish failed queries from confirmed offline state', () => {
  const config = { host: 'valheim.example.com', gamePort: 10470, queryPort: 10471 };
  const card = statusEmbed(config, { ...parseInfo(packet()), latencyMs: 10 });
  assert.equal(card.title, 'Valheim • Online');
  assert.equal(card.fields.find(field => field.name === 'Server').value, 'Test \\*server\\*');
  assert.equal(card.fields.find(field => field.name === 'Players (reported)').value, '2 / 10');
  const unavailable = statusEmbed(config, { status: 'unavailable', reason: 'timeout' });
  assert.equal(unavailable.title, 'Valheim • Query unavailable');
  assert.match(unavailable.footer.text, /does not prove/);
});

test('duplicate and excess concurrent checks are bounded and recover after completion', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const f = fixture(async () => { await blocked; return { ...parseInfo(packet()), latencyMs: 1 }; });
  const pending = [];
  try {
    for (const guild of ['guild-a', 'guild-b', 'guild-c', 'guild-d', 'guild-e']) {
      f.enabled.add(guild);
      await f.configure(guild);
    }
    pending.push(f.service.status('guild-a'));
    await assert.rejects(() => f.service.status('guild-a'), /already running/);
    for (const guild of ['guild-b', 'guild-c', 'guild-d']) pending.push(f.service.status(guild));
    await assert.rejects(() => f.service.status('guild-e'), /busy/);
    release();
    await Promise.all(pending);
    assert.equal((await f.service.status('guild-e')).result.status, 'online');
  } finally { release(); await Promise.allSettled(pending); }
});

test('identical configuration preserves monitor baseline; target changes reset it', async () => {
  const f = fixture(); await f.configure();
  const row = f.rows.get('guild-a');
  Object.assign(row, { monitorStatus: 'unavailable', lastNotifiedStatus: 'unavailable', consecutiveFailures: 3, lastCheckedAt: new Date() });
  await f.configure();
  assert.equal(f.rows.get('guild-a').monitorStatus, 'unavailable');
  await f.configure('guild-a', 'new-host.example');
  assert.equal(f.rows.get('guild-a').monitorStatus, null);
  assert.equal(f.rows.get('guild-a').lastNotifiedStatus, null);
  assert.equal(f.rows.get('guild-a').consecutiveFailures, 0);
});
