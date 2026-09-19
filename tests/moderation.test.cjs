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
const casesCommand = require('../dist/modules/moderation/cases');
const caseCommand = require('../dist/modules/moderation/case');
const reasonCommand = require('../dist/modules/moderation/reason');
const kickCommand = require('../dist/modules/moderation/kick');
const banCommand = require('../dist/modules/moderation/ban');
const { execute: dispatch } = require('../dist/core/events/interactionCreate');
const { WebhookError } = require('../dist/integrations/webhooks/errors');
const { execute: moderationAdmin } = require('../dist/modules/moderation/admin');

function repository() {
  const configs = new Map();
  const cases = [];
  let number = 0;
  return { configs, cases, database: {
    moderationConfig: {
      upsert: async args => { const row = { guildId: args.where.guildId, ...(configs.get(args.where.guildId) ? args.update : args.create) }; configs.set(row.guildId, row); return row; },
      findUnique: async args => configs.get(args.where.guildId) ?? null,
      deleteMany: async args => { const count = configs.delete(args.where.guildId) ? 1 : 0; return { count }; },
    },
    moderationCase: {
      create: async args => { const row = { id: `case-${++number}`, action: 'warn', durationMinutes: null,
        createdAt: new Date(number * 1000), updatedAt: new Date(number * 1000), reasonUpdatedAt: null, reasonUpdatedById: null, ...args.data }; cases.push(row); return row; },
      count: async args => cases.filter(row => row.guildId === args.where.guildId && (!args.where.targetUserId || row.targetUserId === args.where.targetUserId) && (!args.where.action || row.action === args.where.action)).length,
      findMany: async args => cases.filter(row => row.guildId === args.where.guildId && (!args.where.targetUserId || row.targetUserId === args.where.targetUserId) && (!args.where.action || row.action === args.where.action))
        .sort((a, b) => b.createdAt - a.createdAt).slice(args.skip ?? 0, (args.skip ?? 0) + args.take),
      findFirst: async args => cases.find(row => row.guildId === args.where.guildId && row.id === args.where.id) ?? null,
      updateMany: async args => { const row = cases.find(row => row.guildId === args.where.guildId && row.id === args.where.id); if (row) Object.assign(row, args.data); return { count: row ? 1 : 0 }; },
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
    permissions: { has: () => options.botCanModerate !== false },
    moderatable: options.moderatable !== false,
    kickable: options.kickable !== false,
    bannable: options.bannable !== false,
    isCommunicationDisabled: () => Boolean(options.timedOut),
    timeout: options.timeout ?? (async () => {}),
    kick: options.kick ?? (async () => {}),
    ban: options.ban ?? (async () => {}),
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
    user: actor.user, inGuild: () => true, memberPermissions: { has: permission => options.authorized !== false && permission === (options.permission ?? PermissionFlagsBits.ModerateMembers) },
    options: {
      getUser: () => target.user,
      getString: name => name === 'reason' ? (options.reason ?? 'Repeated spam') : name === 'id' ? (options.id ?? 'case-1') : null,
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

test('guild case listing is scoped, filtered, and paginated', async () => {
  const f = serviceFixture();
  await f.service.configure('guild-a', 'log-a');
  await f.service.configure('guild-b', 'log-b');
  for (let index = 0; index < 21; index++) await f.service.addWarning('guild-a', 'member-a', 'mod', `Reason ${index}`);
  await f.service.addWarning('guild-b', 'member-b', 'mod', 'Other server');
  const first = await f.service.listGuildCases('guild-a', { page: 1 });
  const second = await f.service.listGuildCases('guild-a', { page: 2, memberId: 'member-a', action: 'warn' });
  assert.equal(first.total, 21);
  assert.equal(first.records.length, 20);
  assert.equal(second.total, 21);
  assert.equal(second.records.length, 1);
  assert.equal((await f.service.listGuildCases('guild-a', { page: 1, action: 'ban' })).total, 0);
  assert.equal((await f.service.listGuildCases('guild-b', { page: 1 })).total, 1);
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
  assert.throws(() => assertTargetHierarchy(actor, member('target', 10, guild), member('moxie', 30, guild, { bot: true, botCanModerate: false }), 'kick'), /Kick Members/);
});

test('moderation commands are guild-only, require Moderate Members, and are privately deferred by the module gate', async () => {
  for (const command of [warnCommand, warningsCommand, timeoutCommand, untimeoutCommand, casesCommand, caseCommand, reasonCommand]) {
    const json = command.data.toJSON();
    assert.equal(json.dm_permission, false);
    assert.equal(json.default_member_permissions, String(PermissionFlagsBits.ModerateMembers));
    assert.equal(command.ephemeral, true);
  }
  assert.equal(kickCommand.data.toJSON().default_member_permissions, String(PermissionFlagsBits.KickMembers));
  assert.equal(banCommand.data.toJSON().default_member_permissions, String(PermissionFlagsBits.BanMembers));
  assert.equal(kickCommand.ephemeral, true); assert.equal(banCommand.ephemeral, true);
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
  assert.equal(f.cases.length, 1);
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

test('combined history and case details include all actions but remain guild scoped', async () => {
  const f = serviceFixture(); await f.service.configure('guild-a', 'mod-log'); await f.service.configure('guild-b', 'other-log');
  await f.service.createCase('guild-a', 'target', 'moderator', 'warn', 'warning');
  const timeout = await f.service.createCase('guild-a', 'target', 'moderator', 'timeout', 'cool down', 15);
  await f.service.createCase('guild-b', 'target', 'moderator', 'ban', 'other guild');
  const listed = interaction();
  await actions.listCases(listed.mock, f.service);
  const description = listed.mock.calls.at(-1)[1].embeds[0].description;
  assert.match(description, /Warning/); assert.match(description, /Timeout/); assert.doesNotMatch(description, /other guild/);
  const details = interaction({ id: timeout.id });
  await actions.showCase(details.mock, f.service);
  assert.equal(details.mock.calls.at(-1)[1].embeds[0].title, 'Moderation case • Timeout');
  const foreign = interaction({ id: 'case-3' });
  await actions.showCase(foreign.mock, f.service);
  assert.match(foreign.mock.calls.at(-1)[1].content, /No moderation case/);
  const departed = interaction();
  departed.guild.members.fetch = async id => { if (id === departed.actor.id) return departed.actor; throw new Error('not a member'); };
  await actions.listCases(departed.mock, f.service);
  assert.match(departed.mock.calls.at(-1)[1].embeds[0].description, /Timeout/);
});

test('reason corrections retain case identity and record editor metadata and an audit card', async () => {
  const f = serviceFixture(); await f.service.configure('guild-a', 'mod-log');
  const record = await f.service.createCase('guild-a', 'target', 'moderator', 'warn', 'old reason');
  const edited = interaction({ id: record.id, reason: 'corrected reason' });
  const logs = [];
  await actions.editReason(edited.mock, f.service, { send: async (...args) => logs.push(args) });
  const saved = await f.service.getCase('guild-a', record.id);
  assert.equal(saved.reason, 'corrected reason');
  assert.equal(saved.reasonUpdatedById, 'moderator');
  assert.ok(saved.reasonUpdatedAt instanceof Date);
  assert.equal(logs[0][3].title, 'Moderation • Reason corrected');
  assert.equal(logs[0][3].fields.find(field => field.name === 'Previous reason').value, 'old reason');
  assert.match(edited.mock.calls.at(-1)[1].content, /Reason updated/);
});

test('kick and ban require their specific permissions, execute Discord actions, and save cases', async () => {
  const f = serviceFixture(); await f.service.configure('guild-a', 'mod-log');
  const calls = [];
  const kicked = interaction({ permission: PermissionFlagsBits.KickMembers });
  kicked.target.kick = async reason => calls.push(['kick', reason]);
  await actions.kick(kicked.mock, f.service, { send: async () => {} });
  const banned = interaction({ permission: PermissionFlagsBits.BanMembers });
  banned.target.ban = async options => calls.push(['ban', options.reason]);
  await actions.ban(banned.mock, f.service, { send: async () => {} });
  assert.deepEqual(calls.map(call => call[0]), ['kick', 'ban']);
  assert.ok(calls.every(call => call[1].includes('Repeated spam')));
  assert.deepEqual(f.cases.map(row => row.action), ['kick', 'ban']);
  assert.match(kicked.mock.calls.at(-1)[1].content, /kicked.*Case ID/);
  assert.match(banned.mock.calls.at(-1)[1].content, /banned.*Case ID/);
});

test('failed Discord actions do not create false cases', async () => {
  const f = serviceFixture(); await f.service.configure('guild-a', 'mod-log');
  const failed = interaction({ permission: PermissionFlagsBits.KickMembers });
  failed.target.kick = async () => { throw new Error('Discord detail'); };
  await actions.kick(failed.mock, f.service, { send: async () => assert.fail('must not log') });
  assert.equal(f.cases.length, 0);
  assert.match(failed.mock.calls.at(-1)[1].content, /Discord rejected/);
  assert.doesNotMatch(failed.mock.calls.at(-1)[1].content, /Discord detail/);
});

test('a successful Discord action reports a case-storage failure explicitly', async () => {
  const acted = interaction({ permission: PermissionFlagsBits.KickMembers });
  let kicked = false; acted.target.kick = async () => { kicked = true; };
  const service = { requireConfig: async () => ({ logChannelId: 'mod-log' }),
    createCase: async () => { throw new (require('../dist/core/database/guildConfiguration').ConfigurationUnavailableError)(); } };
  await actions.kick(acted.mock, service, { send: async () => assert.fail('must not log without a case') });
  assert.equal(kicked, true);
  assert.match(acted.mock.calls.at(-1)[1].content, /action succeeded.*could not save/);
});

test('timeouts and removals use Discord actions, role checks, audit reasons, and log cards', async () => {
  const f = serviceFixture(); await f.service.configure('guild-a', 'mod-log');
  const timeoutCalls = [];
  const first = interaction({ minutes: 90 });
  first.target.timeout = async (...args) => timeoutCalls.push(args);
  const logs = [];
  await actions.timeout(first.mock, f.service, { send: async (...args) => logs.push(args) });
  assert.equal(timeoutCalls[0][0], 90 * 60_000);
  assert.match(timeoutCalls[0][1], /Repeated spam/);
  assert.equal(logs[0][3].title, 'Moderation • Timeout');
  const second = interaction({ targetOptions: { timedOut: true } });
  second.target.timeout = async (...args) => timeoutCalls.push(args);
  await actions.untimeout(second.mock, f.service, { send: async (...args) => logs.push(args) });
  assert.equal(timeoutCalls[1][0], null);
  assert.equal(logs[1][3].title, 'Moderation • Timeout removed');
  assert.deepEqual(f.cases.map(row => row.action), ['timeout', 'untimeout']);
});

test('actions reject missing permission and safely report audit delivery failures after a saved warning', async () => {
  const unauthorized = interaction({ authorized: false }); unauthorized.mock.deferred = false;
  await actions.warn(unauthorized.mock, { addWarning: () => assert.fail('must not write') }, { send: () => assert.fail('must not send') });
  assert.equal(unauthorized.mock.calls[0][0], 'reply');
  assert.equal(unauthorized.mock.calls[0][1].flags, MessageFlags.Ephemeral);
  const f = serviceFixture(); await f.service.configure('guild-a', 'mod-log');
  const failing = interaction();
  await actions.warn(failing.mock, f.service, { send: async () => { throw new WebhookError(502, 'secret backend detail'); } });
  assert.equal(f.cases.length, 1);
  assert.match(failing.mock.calls.at(-1)[1].content, /saved.*log could not be delivered/);
  assert.doesNotMatch(failing.mock.calls.at(-1)[1].content, /secret backend/);
});
