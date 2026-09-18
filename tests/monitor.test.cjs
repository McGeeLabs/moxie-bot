const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ValheimMonitor, nextMonitorState } = require('../dist/modules/valheim/monitor');
const { PeriodicTask } = require('../dist/core/scheduler/periodicTask');
const { persistenceSnapshot } = require('../dist/core/database/verifyPersistence');
const databaseHealth = require('../dist/core/database');
const { execute: health } = require('../dist/modules/admin/health');

const online = { status: 'online', name: 'Server', map: 'World', players: 1, maxPlayers: 10, passwordProtected: true, version: '1', latencyMs: 10 };
const unavailable = { status: 'unavailable', reason: 'timeout' };

function fixture() {
  let row = { guildId: 'guild-a', host: 'server.example', gamePort: 10470, queryPort: 10471, channelId: 'channel-a',
    monitorStatus: null, lastNotifiedStatus: null, consecutiveFailures: 0, lastCheckedAt: null, updatedAt: new Date(1000) };
  let enabled = true;
  let result = online;
  let failSend = false;
  let beforeQuery = async () => {};
  const sent = [];
  const model = {
    findMany: async () => enabled && row ? [{ ...row }] : [],
    findUnique: async () => row ? { ...row } : null,
    updateMany: async args => {
      if (!row || (args.where.updatedAt && row.updatedAt.getTime() !== args.where.updatedAt.getTime()) ||
        (args.where.monitorStatus && row.monitorStatus !== args.where.monitorStatus)) return { count: 0 };
      Object.assign(row, args.data, { updatedAt: new Date(row.updatedAt.getTime() + 1) });
      return { count: 1 };
    },
  };
  const delivery = { send: async (...args) => { if (failSend) throw new Error('delivery unavailable'); sent.push(args); } };
  const configuration = { isEnabled: async () => enabled };
  const query = async () => { await beforeQuery(); return result; };
  const makeMonitor = () => new ValheimMonitor(delivery, () => ({ valheimServerConfig: model }), configuration, query);
  return { makeMonitor, sent, row: () => row, setResult: value => { result = value; }, setEnabled: value => { enabled = value; },
    failSend: value => { failSend = value; }, beforeQuery: action => { beforeQuery = action; }, deleteRow: () => { row = null; } };
}

test('first stable baseline is quiet; only three failures alert and recovery alerts once', async () => {
  const f = fixture();
  const monitor = f.makeMonitor();
  await monitor.runOnce();
  assert.equal(f.row().monitorStatus, 'online');
  assert.equal(f.sent.length, 0);
  f.setResult(unavailable);
  await monitor.runOnce(); await monitor.runOnce();
  assert.equal(f.sent.length, 0);
  await monitor.runOnce();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0][0], 'guild-a');
  assert.equal(f.sent[0][1], 'channel-a');
  assert.match(f.sent[0][3].description, /Three consecutive/);
  await monitor.runOnce();
  assert.equal(f.sent.length, 1);
  f.setResult(online);
  await monitor.runOnce(); await monitor.runOnce();
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1][3].title, 'Valheim • Connection restored');
});

test('monitor restart retains the baseline and does not repeat the unavailable alert', async () => {
  const f = fixture();
  const first = f.makeMonitor();
  await first.runOnce();
  f.setResult(unavailable);
  await first.runOnce(); await first.runOnce(); await first.runOnce();
  await first.stop();
  const restarted = f.makeMonitor();
  await restarted.runOnce();
  assert.equal(f.sent.length, 1);
  f.setResult(online);
  await restarted.runOnce();
  assert.equal(f.sent.length, 2);
});

test('delivery failure keeps transition pending and retries on a later cycle', async () => {
  const f = fixture(); const monitor = f.makeMonitor();
  await monitor.runOnce();
  f.setResult(unavailable); f.failSend(true);
  await monitor.runOnce(); await monitor.runOnce(); await monitor.runOnce();
  assert.equal(f.row().monitorStatus, 'unavailable');
  assert.equal(f.row().lastNotifiedStatus, 'online');
  assert.equal(monitor.status.deliveryErrors, 1);
  f.failSend(false);
  await monitor.runOnce();
  assert.equal(f.sent.length, 1);
  assert.equal(f.row().lastNotifiedStatus, 'unavailable');
});

test('an undelivered recovery is not announced during later failed queries', async () => {
  const f = fixture(); const monitor = f.makeMonitor();
  await monitor.runOnce(); f.setResult(unavailable);
  await monitor.runOnce(); await monitor.runOnce(); await monitor.runOnce();
  f.setResult(online); f.failSend(true); await monitor.runOnce();
  f.setResult(unavailable); f.failSend(false); await monitor.runOnce();
  assert.equal(f.sent.length, 1);
  f.setResult(online); await monitor.runOnce();
  assert.equal(f.sent.length, 2);
});

test('disabled guilds do not query or deliver; module changes during a query suppress alerts', async () => {
  const f = fixture(); const monitor = f.makeMonitor();
  f.setEnabled(false); await monitor.runOnce();
  assert.equal(f.row().lastCheckedAt, null);
  f.setEnabled(true); await monitor.runOnce();
  f.setResult(unavailable); await monitor.runOnce(); await monitor.runOnce();
  f.beforeQuery(async () => f.setEnabled(false));
  await monitor.runOnce();
  assert.equal(f.sent.length, 0);
});

test('configuration changes or removal while a query runs cannot deliver to stale destinations', async () => {
  for (const remove of [false, true]) {
    const f = fixture(); const monitor = f.makeMonitor();
    await monitor.runOnce(); f.setResult(unavailable);
    await monitor.runOnce(); await monitor.runOnce();
    f.beforeQuery(async () => {
      if (remove) f.deleteRow();
      else Object.assign(f.row(), { channelId: 'new-channel', updatedAt: new Date(50000) });
    });
    await monitor.runOnce();
    assert.equal(f.sent.length, 0);
  }
});

test('initial unavailable server establishes a quiet baseline after debounce', async () => {
  const f = fixture(); const monitor = f.makeMonitor(); f.setResult(unavailable);
  await monitor.runOnce(); await monitor.runOnce(); await monitor.runOnce();
  assert.equal(f.row().monitorStatus, 'unavailable');
  assert.equal(f.sent.length, 0);
});

test('shutdown waits for active query and prevents delivery/state changes afterward', async () => {
  const f = fixture(); const monitor = f.makeMonitor();
  let release; let reached;
  const blocked = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { reached = resolve; });
  f.beforeQuery(async () => { reached(); await blocked; });
  const cycle = monitor.runOnce(); await ready;
  let stopped = false; const stopping = monitor.stop().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false);
  release(); await cycle; await stopping;
  assert.equal(f.row().lastCheckedAt, null);
  assert.equal(f.sent.length, 0);
});

test('periodic tasks do not overlap; stop drains active work and failures are reported', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const task = new PeriodicTask('test', async () => { calls++; await blocked; });
  const first = task.runOnce(); const second = task.runOnce();
  assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1);
  const stopped = task.stop(); release(); await stopped;
  assert.ok(task.status.lastSuccessAt);
  await task.runOnce(); assert.equal(calls, 1);
  const failing = new PeriodicTask('test-failure', async () => { throw new Error('secret raw error'); });
  await failing.runOnce(); assert.equal(failing.status.errors, 1);
  assert.equal(failing.status.lastSuccessAt, undefined);
});

test('monitor state resets intermittent failures on success', () => {
  assert.deepEqual(nextMonitorState('online', 2, true), { monitorStatus: 'online', consecutiveFailures: 0 });
  assert.deepEqual(nextMonitorState('online', 2, false), { monitorStatus: 'unavailable', consecutiveFailures: 3 });
});

test('persistence fingerprint is order-independent, contains no secret hashes, and detects config changes', async () => {
  const rows = {
    guild: [{ id: 'guild-b' }, { id: 'guild-a' }], guildModuleConfig: [{ guildId: 'guild-a', module: 'valheim', enabled: true }],
    webhookRoute: [{ id: 'route', guildId: 'guild-a', name: 'kuma', secretHash: 'secret-hash' }],
    valheimServerConfig: [{ guildId: 'guild-a', host: 'server.example', gamePort: 10470, queryPort: 10471, channelId: 'channel-a' }],
  };
  const db = Object.fromEntries(Object.keys(rows).map(name => [name, { findMany: async args => rows[name].map(row =>
    Object.fromEntries(Object.keys(args.select).map(key => [key, row[key]]))) }]));
  const first = await persistenceSnapshot(db);
  rows.guild.reverse();
  assert.deepEqual(await persistenceSnapshot(db), first);
  assert.ok(!JSON.stringify(first).includes('secret-hash'));
  rows.valheimServerConfig[0].monitorStatus = 'unavailable';
  rows.valheimServerConfig[0].consecutiveFailures = 3;
  assert.deepEqual(await persistenceSnapshot(db), first);
  rows.valheimServerConfig[0].queryPort++;
  assert.notEqual((await persistenceSnapshot(db)).digest, first.digest);
});

test('health shows scheduler progress, last successful cycle, and safe error counters', async t => {
  t.mock.method(databaseHealth, 'checkDatabase', async () => ({ status: 'connected', latencyMs: 10 }));
  const replies = [];
  await health({ inGuild: () => true, memberPermissions: { has: () => true },
    client: { isReady: () => true, ws: { ping: 50 }, valheimMonitor: { status: {
      running: true, inProgress: false, lastSuccessAt: new Date('2026-09-18T20:00:00Z'),
      checkedLastCycle: 1, unavailableLastCycle: 0, errors: 2, deliveryErrors: 1,
    } } }, deferReply: async () => {}, editReply: async value => replies.push(value),
  });
  assert.match(replies[0].content, /Valheim scheduler: Running \(60s\)/);
  assert.match(replies[0].content, /2026-09-18T20:00:00.000Z/);
  assert.match(replies[0].content, /Scheduler errors: 2; alert delivery errors: 1/);
});

test('retained configuration for departed guilds is excluded before the scheduler batch limit', async () => {
  let filter;
  const monitor = new ValheimMonitor({ send: async () => assert.fail('must not send') },
    () => ({ valheimServerConfig: { findMany: async args => { filter = args.where; return []; } } }),
    {}, async () => assert.fail('must not query'), () => true, () => ['guild-a']);
  await monitor.runOnce();
  assert.deepEqual(filter.guildId, { in: ['guild-a'] });
});
