const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { GuildConfiguration, ConfigurationUnavailableError } = require('../dist/core/database/guildConfiguration');
const { execute: dispatch } = require('../dist/core/events/interactionCreate');
const { execute: admin, data } = require('../dist/modules/admin/moxie');
const { execute: ready } = require('../dist/core/events/ready');
const { execute: about } = require('../dist/modules/status/about');

function repository() {
  const guilds = new Set();
  const records = new Map();
  return {
    guilds, records,
    guild: { upsert: async args => { guilds.add(args.where.id); return { id: args.where.id }; } },
    guildModuleConfig: {
      createMany: async args => {
        for (const row of args.data) {
          const key = `${row.guildId}/${row.module}`;
          if (!records.has(key)) records.set(key, { ...row });
        }
      },
      findMany: async args => [...records.values()].filter(row => row.guildId === args.where.guildId),
      upsert: async args => {
        const { guildId, module } = args.where.guildId_module;
        const key = `${guildId}/${module}`;
        records.set(key, { ...(records.get(key) ?? args.create), ...args.update });
        return records.get(key);
      },
    },
  };
}

function interaction(overrides = {}) {
  const calls = [];
  const mock = {
    calls, guildId: 'guild-a', commandName: 'about', deferred: false, replied: false,
    isChatInputCommand: () => true,
    inGuild: () => true,
    memberPermissions: { has: () => true },
    user: { id: 'admin-user' },
    options: { getSubcommand: () => 'modules', getString: () => 'status', getBoolean: () => false },
    reply: async value => { calls.push(['reply', value]); mock.replied = true; },
    deferReply: async value => { calls.push(['defer', value]); mock.deferred = true; },
    editReply: async value => { calls.push(['edit', value]); mock.replied = true; },
    followUp: async value => { calls.push(['followUp', value]); },
    ...overrides,
  };
  return mock;
}

test('guild defaults are idempotent, isolated, and persist across service instances', async () => {
  const database = repository();
  const configuration = new GuildConfiguration(() => database);
  await configuration.ensureGuild('guild-a');
  await configuration.ensureGuild('guild-b');
  assert.equal(database.guilds.size, 2);
  assert.equal(await configuration.isEnabled('guild-a', 'status'), true);
  await configuration.setEnabled('guild-a', 'status', false);
  await configuration.ensureGuild('guild-a');
  assert.equal(await configuration.isEnabled('guild-a', 'status'), false);
  assert.equal(await configuration.isEnabled('guild-b', 'status'), true);
  const restarted = new GuildConfiguration(() => database);
  assert.equal(await restarted.isEnabled('guild-a', 'status'), false);
  assert.deepEqual(await restarted.listModules('guild-a'), [
    { name: 'admin', required: true, enabled: true },
    { name: 'status', required: false, enabled: false },
    { name: 'webhooks', required: false, enabled: false },
    { name: 'uptimeKuma', required: false, enabled: false },
    { name: 'valheim', required: false, enabled: false },
  ]);
});

test('required and unknown modules cannot be changed and diagnostics need no database', async () => {
  const configuration = new GuildConfiguration(() => { throw new Error('must not access database'); });
  assert.equal(await configuration.isEnabled('guild-a', 'admin'), true);
  await assert.rejects(() => configuration.setEnabled('guild-a', 'admin', false), /required/);
  await assert.rejects(() => configuration.setEnabled('guild-a', 'invented', true), /Unknown module/);
});

test('database failures become safe configuration errors', async () => {
  const unavailable = new GuildConfiguration(() => undefined);
  await assert.rejects(() => unavailable.listModules('guild-a'), ConfigurationUnavailableError);
  const failing = new GuildConfiguration(() => ({ guild: { upsert: async () => { throw new Error('database-secret'); } } }));
  await assert.rejects(() => failing.ensureGuild('guild-a'), error => error instanceof ConfigurationUnavailableError && !error.message.includes('database-secret'));
});

test('module gate skips disabled commands and allows enabled guilds', async () => {
  let executions = 0;
  const command = { module: 'status', execute: async () => { executions++; } };
  for (const enabled of [false, true]) {
    const mock = interaction({ client: { commands: new Map([['about', command]]) } });
    await dispatch(mock, { isEnabled: async (guildId, module) => {
      assert.equal(guildId, 'guild-a'); assert.equal(module, 'status'); return enabled;
    } });
    assert.equal(mock.calls[0][0], 'defer');
    if (!enabled) assert.match(mock.calls[1][1].content, /disabled in this server/);
  }
  assert.equal(executions, 1);
});

test('module gate fails closed on configuration errors; admin commands bypass it', async () => {
  let executions = 0;
  const unavailable = { isEnabled: async () => { throw new ConfigurationUnavailableError(); } };
  const mock = interaction({ client: { commands: new Map([['about', { module: 'status', execute: async () => { executions++; } }]]) } });
  await dispatch(mock, unavailable);
  assert.equal(executions, 0);
  assert.match(mock.calls[1][1].content, /configuration is unavailable/);
  const diagnostic = interaction({ commandName: 'ping', client: { commands: new Map([['ping', { module: 'admin', execute: async () => { executions++; } }]]) } });
  await dispatch(diagnostic, unavailable);
  assert.equal(executions, 1);
});

test('toggleable module commands reject direct messages', async () => {
  const mock = interaction({ guildId: null, client: { commands: new Map([['about', { module: 'status', execute: async () => assert.fail('must not run') }]]) } });
  await dispatch(mock, { isEnabled: async () => assert.fail('must not query') });
  assert.match(mock.calls[0][1].content, /servers only/);
  assert.equal(mock.calls[0][1].flags, MessageFlags.Ephemeral);
});

test('all admin subcommands enforce guild Administrator permissions before reading settings', async () => {
  for (const subcommand of ['health', 'modules', 'module']) {
    for (const inGuild of [true, false]) {
      const mock = interaction({
        inGuild: () => inGuild, memberPermissions: { has: () => false },
        options: { getSubcommand: () => subcommand },
      });
      await admin(mock, { listModules: () => assert.fail('must not read'), setEnabled: () => assert.fail('must not change') });
      assert.equal(mock.calls[0][1].flags, MessageFlags.Ephemeral);
      assert.match(mock.calls[0][1].content, /requires Administrator/);
    }
  }
});

test('admin listing and toggle update use the interaction guild and ephemeral replies', async () => {
  const database = repository();
  const configuration = new GuildConfiguration(() => database);
  const list = interaction();
  await admin(list, configuration);
  assert.match(list.calls[1][1].content, /admin.*required/);
  assert.equal(list.calls[0][1].flags, MessageFlags.Ephemeral);
  const toggle = interaction({ options: { getSubcommand: () => 'module', getString: () => 'status', getBoolean: () => false } });
  await admin(toggle, configuration);
  assert.equal(await configuration.isEnabled('guild-a', 'status'), false);
  assert.equal(await configuration.isEnabled('guild-b', 'status'), true);
  assert.match(toggle.calls[1][1].content, /disabled/);
  assert.equal(toggle.calls[0][1].flags, MessageFlags.Ephemeral);
  assert.deepEqual(data.toJSON().options.map(option => option.name), ['health', 'modules', 'module', 'webhook', 'valheim']);
});

test('startup sync attempts every guild even when one registration fails', async () => {
  const attempted = [];
  await ready({ user: { tag: 'Moxie' }, guilds: { cache: new Map([['guild-a', {}], ['guild-b', {}]]) } }, {
    ensureGuild: async guildId => { attempted.push(guildId); if (guildId === 'guild-a') throw new Error('unavailable'); },
  });
  assert.deepEqual(attempted, ['guild-a', 'guild-b']);
});

test('about edits an existing deferred response rather than acknowledging twice', async () => {
  const mock = interaction({ deferred: true, client: { ws: { ping: 20 } } });
  await about(mock);
  assert.ok(mock.calls.every(([method]) => method === 'edit'));
  assert.match(mock.calls.at(-1)[1], /Moxie/);
});
