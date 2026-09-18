const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatUptimeKumaEvent } = require('../dist/integrations/uptimeKuma/formatter');
const { WebhookService, WebhookError } = require('../dist/integrations/webhooks/service');
const { createHash } = require('node:crypto');
const { DiscordWebhookDelivery } = require('../dist/integrations/webhooks/discordDelivery');
const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');

const event = status => ({ msg: 'Monitor notification', monitor: { name: 'forge01', password: 'never-display', url: 'https://private.example' },
  heartbeat: { status, ping: 42, time: '2026-09-18 20:00:00', msg: 'OK' } });

test('Kuma formats all four states and ignores monitor credentials', () => {
  for (const [status, label] of ['DOWN', 'UP', 'PENDING', 'MAINTENANCE'].entries()) {
    const { content, embed } = formatUptimeKumaEvent(event(status));
    assert.ok(content.includes(`Uptime Kuma — ${label}`));
    assert.match(content, /Monitor: forge01\nLatency: 42ms/);
    assert.ok(!content.includes('never-display'));
    assert.ok(!content.includes('private.example'));
    assert.equal(embed.fields.find(field => field.name === 'Status').value, label);
    assert.equal(embed.fields.find(field => field.name === 'Latency').value, '42 ms');
    assert.ok(!JSON.stringify(embed).includes('never-display'));
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
  const { content, embed } = formatUptimeKumaEvent(payload);
  assert.ok(content.length <= 1900);
  for (const secret of ['password', 'token=secret', '#secret', 'abc123']) {
    assert.ok(!content.includes(secret));
    assert.ok(!JSON.stringify(embed).includes(secret));
  }
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
  assert.equal(sent[0][3].title, 'Service online');
  assert.equal(sent[0][3].color, 0x22c55e);
  assert.equal(sent[0][3].footer.text, 'Moxie • Uptime Kuma • kuma');
  enabled.delete('webhooks');
  await assert.rejects(() => service.dispatch('route', token, event(1)), error => error.status === 403);
  await assert.rejects(() => service.dispatch('route', 'b'.repeat(64), event(1)), error => error.status === 401);
  assert.equal(sent.length, 1);
});

test('Discord sends Kuma as a visible embed with mentions disabled and checks Embed Links permission', async () => {
  let embedAllowed = true;
  const sent = [];
  const channel = { guildId: 'guild-a', type: ChannelType.GuildText,
    permissionsFor: () => ({ has: value => value === PermissionFlagsBits.EmbedLinks ? embedAllowed : true }),
    send: async value => sent.push(value) };
  const client = { isReady: () => true, guilds: { fetch: async () => ({
    channels: { fetch: async () => channel }, members: { me: {} }
  }) } };
  const delivery = new DiscordWebhookDelivery(client);
  const eventData = formatUptimeKumaEvent(event(0));
  await delivery.send('guild-a', 'channel-a', eventData.content, eventData.embed);
  assert.equal(sent[0].embeds[0].title, 'Service offline');
  assert.equal(sent[0].embeds[0].color, 0xef4444);
  assert.equal(sent[0].content, undefined);
  assert.equal(sent[0].flags, undefined);
  assert.deepEqual(sent[0].allowedMentions, { parse: [], repliedUser: false });
  embedAllowed = false;
  await assert.rejects(() => delivery.send('guild-a', 'channel-a', eventData.content, eventData.embed),
    error => error instanceof WebhookError && error.status === 403 && /Embed Links/.test(error.message));
  await delivery.send('guild-a', 'channel-a', 'generic text');
  assert.equal(sent[1].content, 'generic text');
  assert.equal(sent[1].flags, MessageFlags.SuppressEmbeds);
});
