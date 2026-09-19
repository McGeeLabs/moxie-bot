const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ModerationService, ModerationError, normalizeReason } = require('../dist/modules/moderation/service');
const { assertTargetHierarchy } = require('../dist/modules/moderation/permissions');
const actions = require('../dist/modules/moderation/actions');
const warnCommand = require('../dist/modules/moderation/warn');
const warningsCommand = require('../dist/modules/moderation/warnings');
const timeoutCommand = require('../dist/modules/moderation/timeout');
const untimeoutCommand = require('../dist/modules/moderation/untimeout');
const { execute: dispatch } = require('../dist/core/events/interactionCreate');
const { WebhookError } = require('../dist/integrations/webhooks/errors');
const { execute: moderationAdmin } = require('../dist/modules/moderation/admin');

function repository() {
  const configs = new Map();
  const warnings = [];
  let number = 0;
  return { configs, warnings, database: {
    moderationConfig: {
      upsert: async args => { const row = { guildId: args.where.guildId, ...(configs.get(args.where.guildId) ? args.update : args.create) }; configs.set(row.guildId, row); return row; },
      findUnique: async args => configs.get(args.where.guildId) ?? null,
      deleteMany: async args => { const count = configs.delete(args.where.guildId) ? 1 : 0; return { count }; },
    },
    moderationWarning: {
      create: async args => { const row = { id: `case-${++number}`, createdAt: new Date(number * 1000), ...args.data }; warnings.push(row); return row; },
      count: async args => warnings.filter(row => row.guildId === args.where.guildId && row.targetUserId === args.where.targetUserId).length,
      findMany: async args => warnings.filter(row => row.guildId === args.where.guildId && row.targetUserId === args.where.targetUserId)
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, args.take),
    },
  } };
}

function serviceFixture() {
  const repo = repository();
  const ensured = [];
  const service = new ModerationService(() => repo.database, { ensureGuild: async id => ensured.push(id) });
  return { ...repo, service, ensured };
}

function member(id, position, guild, options = {}) {
  return {
    id, guild, user: { id, tag: `${id}#0001`, bot: Boolean(options.bot) },
    roles: { highest: { comparePositionTo: other => position - other.position, position } },
    permissions: { has: permission => options.botCanModerate !== false && permission === PermissionFlagsBits.ModerateMembers },
    moderatable: options.moderatable !== false,
    isCommunicationDisabled: () => Boolean(options.timedOut),
    timeout: options.timeout ?? (async () => {}),
  };
}

function interaction(options = {}) {
  const calls = [];
  const guild = { ownerId: 'owner', members: {} };
  const actor = member('moderator', 30, guild);
  const target = member('target', 10, guild, options.targetOptions);
  const bot = member('moxie', 40, guild, { bot: true, botCanModerate: options.botCanModerate });
  guild.members.fetch = async id => id === actor.id ? actor : target;
  guild.members.fetchMe = async () => bot;
  const mock = {
    guildId: 'guild-a', guild, deferred: true, replied: false, commandName: 'warn',
    user: actor.user, inGuild: () => true, memberPermissions: { has: permission => options.authorized !== false && permission === PermissionFlagsBits.ModerateMembers },
    options: {
      getUser: () => target.user,
      getString: name => name === 'reason' ? (options.reason ?? 'Repeated spam') : null,
      getInteger: () => options.minutes ?? 30,
    },
    reply: async payload => calls.push(['reply', payload]),
    deferReply: async payload => { mock.deferred = true; calls.push(['defer', payload]); },
    editReply: async payload => calls.push(['edit', payload]),
    calls,
  };
  return { mock, actor, target, bot, guild };
}

test('moderation configuration and warning history are isolated by guild', async () => {
  const f = serviceFixture();
  await f.service.configure('guild-a', 'log-a');
  await f.service.configure('guild-b', 'log-b');
  await f.service.addWarning('guild-a', 'member', 'mod-a', ' First\nreason ');
  await f.service.addWarning('guild-a', 'member', 'mod-b', 'Second reason');
  await f.service.addWarning('guild-b', 'member', 'mod-b', 'Other guild');
  assert.deepEqual(f.ensured, ['guild-a', 'guild-b']);
  assert.equal((await f.service.getConfig('guild-a')).logChannelId, 'log-a');
  const history = await f.service.warnings('guild-a', 'member');
  assert.equal(history.total, 2);
  assert.deepEqual(history.records.map(row => row.reason), ['Second reason', 'First reason']);
  await f.service.removeConfig('guild-a');
  assert.equal(await f.service.getConfig('guild-a'), null);
  assert.equal((await f.service.warnings('guild-a', 'member')).total, 2);
});

test('administrator configuration validates an embed-capable channel and replies privately', async () => {
  const f = serviceFixture();
  const calls = [];
  const mock = { guildId: 'guild-a', client: {}, user: { id: 'admin' },
    options: { getSubcommand: () => 'configure', getChannel: () => ({ id: 'mod-log' }) },
    deferReply: async value => calls.push(['defer', value]), editReply: async value => calls.push(['edit', value]) };
  await moderationAdmin(mock, f.service, { validateDestination: async (guildId, channelId, embeds) => {
    assert.equal(guildId, 'guild-a'); assert.equal(channelId, 'mod-log'); assert.equal(embeds, true);
  } });
  assert.equal(calls[0][1].flags, MessageFlags.Ephemeral);
  assert.equal((await f.service.getConfig('guild-a')).logChannelId, 'mod-log');
});

test('reasons are normalized and warning creation requires a configured log channel', async () => {
  assert.equal(normalizeReason('  a\n\tb  '), 'a b');
  assert.equal(normalizeReason(''), 'No reason provided.');
  assert.throws(() => normalizeReason('x'.repeat(501)), ModerationError);
  const f = serviceFixture();
  await assert.rejects(() => f.service.addWarning('guild-a', 'member', 'mod', 'reason'), /No moderation log channel/);
});

test('role hierarchy blocks self, bots, owners, peers, and targets above Moxie', () => {
  const guild = { ownerId: 'owner' };
  const actor = member('actor', 20, guild);
  const bot = member('moxie', 30, guild, { bot: true });
  assert.doesNotThrow(() => assertTargetHierarchy(actor, member('target', 10, guild), bot, true));
  assert.throws(() => assertTargetHierarchy(actor, actor, bot, false), /yourself/);
  assert.throws(() => assertTargetHierarchy(actor, member('bot', 10, guild, { bot: true }), bot, false), /Bot accounts/);
  assert.throws(() => assertTargetHierarchy(actor, member('owner', 50, guild), bot, false), /server owner/);
  assert.throws(() => assertTargetHierarchy(actor, member('peer', 20, guild), bot, false), /Your highest role/);
  const ownerGuild = { ownerId: 'actor' };
  assert.throws(() => assertTargetHierarchy(member('actor', 20, ownerGuild), member('high', 35, ownerGuild),
    member('moxie', 30, ownerGuild, { bot: true }), true), /Moxie's highest role/);
});

test('moderation commands are guild-only, require Moderate Members, and are privately deferred by the module gate', async () => {
  for (const command of [warnCommand, warningsCommand, timeoutCommand, untimeoutCommand]) {
    const json = command.data.toJSON();
    assert.equal(json.dm_permission, false);
    assert.equal(json.default_member_permissions, String(PermissionFlagsBits.ModerateMembers));
    assert.equal(command.ephemeral, true);
  }
  let ran = false;
  const calls = [];
  const mock = { commandName: 'warn', guildId: 'guild-a', isChatInputCommand: () => true,
    client: { commands: new Map([['warn', { module: 'moderation', ephemeral: true, execute: async () => { ran = true; } }]]) },
    deferReply: async value => calls.push(value), editReply: async () => {} };
  await dispatch(mock, { isEnabled: async () => true });
  assert.equal(calls[0].flags, MessageFlags.Ephemeral);
  assert.equal(ran, true);
});

test('warn records a case, sends an audit card, and returns a private confirmation', async () => {
  const f = serviceFixture(); await f.service.configure('guild-a', 'mod-log');
  const { mock } = interaction();
  const deliveries = [];
  await actions.warn(mock, f.service, { send: async (...args) => deliveries.push(args) });
  assert.equal(f.warnings.length, 1);
  assert.deepEqual(deliveries[0].slice(0, 3), ['guild-a', 'mod-log', 'Moderation action']);
  assert.equal(deliveries[0][3].title, 'Moderation • Warning');
  assert.match(mock.calls.at(-1)[1].content, /Case ID: `case-1`/);
});

test('warnings are private and show only the target guild history without mentions', async () => {
  const f = serviceFixture(); await f.service.configure('guild-a', 'mod-log');
  await f.service.addWarning('guild-a', 'target', 'moderator', 'test reason');
  const { mock } = interaction();
  await actions.listWarnings(mock, f.service);
  const response = mock.calls.at(-1)[1];
  assert.match(response.embeds[0].description, /test reason/);
  assert.deepEqual(response.allowedMentions, { parse: [] });
});

test('timeouts and removals use Discord actions, role checks, audit reasons, and log cards', async () => {
  const service = { getConfig: async () => ({ logChannelId: 'mod-log' }) };
  const timeoutCalls = [];
  const first = interaction({ minutes: 90 });
  first.target.timeout = async (...args) => timeoutCalls.push(args);
  const logs = [];
  await actions.timeout(first.mock, service, { send: async (...args) => logs.push(args) });
  assert.equal(timeoutCalls[0][0], 90 * 60_000);
  assert.match(timeoutCalls[0][1], /Repeated spam/);
  assert.equal(logs[0][3].title, 'Moderation • Timeout');
  const second = interaction({ targetOptions: { timedOut: true } });
  second.target.timeout = async (...args) => timeoutCalls.push(args);
  await actions.untimeout(second.mock, service, { send: async (...args) => logs.push(args) });
  assert.equal(timeoutCalls[1][0], null);
  assert.equal(logs[1][3].title, 'Moderation • Timeout removed');
});

test('actions reject missing permission and safely report audit delivery failures after a saved warning', async () => {
  const unauthorized = interaction({ authorized: false }); unauthorized.mock.deferred = false;
  await actions.warn(unauthorized.mock, { addWarning: () => assert.fail('must not write') }, { send: () => assert.fail('must not send') });
  assert.equal(unauthorized.mock.calls[0][0], 'reply');
  assert.equal(unauthorized.mock.calls[0][1].flags, MessageFlags.Ephemeral);
  const f = serviceFixture(); await f.service.configure('guild-a', 'mod-log');
  const failing = interaction();
  await actions.warn(failing.mock, f.service, { send: async () => { throw new WebhookError(502, 'secret backend detail'); } });
  assert.equal(f.warnings.length, 1);
  assert.match(failing.mock.calls.at(-1)[1].content, /saved.*log could not be delivered/);
  assert.doesNotMatch(failing.mock.calls.at(-1)[1].content, /secret backend/);
});
