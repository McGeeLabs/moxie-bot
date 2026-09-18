const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatUptimeKumaEvent } = require('../dist/integrations/uptimeKuma/formatter');
const { WebhookService, WebhookError } = require('../dist/integrations/webhooks/service');
const { createHash } = require('node:crypto');

const event = status => ({ msg: 'Monitor notification', monitor: { name: 'forge01', password: 'never-display', url: 'https://private.example' },
  heartbeat: { status, ping: 42, time: '2026-09-18 20:00:00', msg: 'OK' } });

test('Kuma formats all four states and ignores monitor credentials', () => {
  for (const [status, label] of ['DOWN', 'UP', 'PENDING', 'MAINTENANCE'].entries()) {
    const { content } = formatUptimeKumaEvent(event(status));
    assert.ok(content.includes(`Uptime Kuma — ${label}`));
    assert.match(content, /Monitor: forge01\nLatency: 42ms/);
    assert.ok(!content.includes('never-display'));
    assert.ok(!content.includes('private.example'));
  }
});

test('Kuma accepts test and certificate notifications without heartbeat metadata', () => {
  assert.match(formatUptimeKumaEvent({ msg: 'Test', monitor: null, heartbeat: null }).content, /Notification\nTest/);
  assert.match(formatUptimeKumaEvent({ msg: 'Certificate expiring' }).content, /Certificate expiring/);
});

test('Kuma rejects malformed statuses and destination overrides', () => {
  for (const value of [null, [], {}, { msg: ' ' }, { ...event(1), guildId: 'other' }, event(4), event('1'),
    { ...event(1), monitor: {} }, { ...event(1), heartbeat: { status: 1, ping: -1 } }]) {
    assert.throws(() => formatUptimeKumaEvent(value), error => error instanceof WebhookError && error.status === 400);
  }
});

test('Kuma bounds output and strips URL credentials, query strings, and bearer tokens', () => {
  const payload = event(1);
  payload.heartbeat.msg = 'https://user:password@example.com/status?token=secret#secret Bearer abc123 ' + '*'.repeat(5000);
  const { content } = formatUptimeKumaEvent(payload);
  assert.ok(content.length <= 1900);
  for (const secret of ['password', 'token=secret', '#secret', 'abc123']) assert.ok(!content.includes(secret));
});

test('Kuma dispatch requires both guild modules and keeps the saved destination', async () => {
  const token = 'a'.repeat(64);
  const route = { id: 'route', guildId: 'guild-a', channelId: 'channel-a', name: 'kuma', provider: 'uptimeKuma',
    secretHash: createHash('sha256').update(token).digest('hex') };
  const enabled = new Set(['webhooks']);
  const sent = [];
  const service = new WebhookService({ send: async (...args) => sent.push(args) },
    () => ({ webhookRoute: { findUnique: async () => route } }),
    { isEnabled: async (guild, module) => { assert.equal(guild, 'guild-a'); return enabled.has(module); } });
  await assert.rejects(() => service.dispatch('route', token, event(1)), error => error.status === 403);
  enabled.add('uptimeKuma');
  await service.dispatch('route', token, event(1));
  assert.equal(sent[0][0], 'guild-a');
  assert.equal(sent[0][1], 'channel-a');
  assert.match(sent[0][2], /\[kuma\] Uptime Kuma — UP/);
  enabled.delete('webhooks');
  await assert.rejects(() => service.dispatch('route', token, event(1)), error => error.status === 403);
  await assert.rejects(() => service.dispatch('route', 'b'.repeat(64), event(1)), error => error.status === 401);
  assert.equal(sent.length, 1);
});
