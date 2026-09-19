const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { CustomCommandService, CustomCommandError } = require('../dist/modules/customCommands/service');
const memberCommand = require('../dist/modules/customCommands/cmd');
const adminCommand = require('../dist/modules/customCommands/admin');
const { execute: dispatch } = require('../dist/core/events/interactionCreate');
const { commands } = require('../dist/modules');
const { guildCommandDefinitions, syncGuildCommands } = require('../dist/modules/customCommands/registration');

function fixture() {
  const rows = new Map();
  const ensured = [];
  const key = (guildId, name) => `${guildId}:${name}`;
  const database = { customCommand: {
    findUnique: async ({ where, select }) => {
      const row = rows.get(key(where.guildId_name.guildId, where.guildId_name.name));
      if (!row) return null;
      return select?.id ? { id: row.id } : { name: row.name, content: row.content };
    },
    count: async ({ where }) => [...rows.values()].filter(row => row.guildId === where.guildId).length,
    create: async ({ data }) => { const row = { id: String(rows.size + 1), ...data }; rows.set(key(data.guildId, data.name), row); return row; },
    findMany: async ({ where, take }) => [...rows.values()].filter(row => row.guildId === where.guildId)
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, take).map(({ name, content }) => ({ name, content })),
    updateMany: async ({ where, data }) => {
      const row = rows.get(key(where.guildId, where.name));
      if (row) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    },
    deleteMany: async ({ where }) => ({ count: rows.delete(key(where.guildId, where.name)) ? 1 : 0 }),
  } };
  const service = new CustomCommandService(() => database, async guildId => ensured.push(guildId));
  return { service, rows, ensured };
}

function interaction(subcommand, strings = {}) {
  const calls = [];
  return { calls, guildId: 'guild-a', user: { id: 'admin-a' }, deferred: true,
    client: { commands: new Map(commands.map(command => [command.data.name, command])) },
    guild: { id: 'guild-a', commands: { set: async () => {} } },
    options: { getSubcommand: () => subcommand, getString: name => strings[name] ?? null },
    deferReply: async payload => calls.push(['defer', payload]),
    editReply: async payload => calls.push(['edit', payload]),
  };
}

test('custom command service isolates guilds and supports text CRUD', async () => {
  const f = fixture();
  assert.equal(await f.service.add('guild-a', ' Rules ', ' Be kind. ', 'admin-a'), 'rules');
  assert.equal(await f.service.add('guild-b', 'rules', 'Different server', 'admin-b'), 'rules');
  assert.deepEqual(f.ensured, ['guild-a', 'guild-b']);
  assert.deepEqual(await f.service.get('guild-a', 'RULES'), { name: 'rules', content: 'Be kind.' });
  assert.equal((await f.service.list('guild-b'))[0].content, 'Different server');
  await assert.rejects(f.service.add('guild-a', 'rules', 'Again', 'admin-a'), /already exists/);
  assert.equal(await f.service.edit('guild-a', 'rules', 'Updated', 'admin-a'), 'rules');
  assert.equal((await f.service.get('guild-a', 'rules')).content, 'Updated');
  await assert.rejects(f.service.edit('guild-a', 'missing', 'No', 'admin-a'), /No command/);
  assert.equal(await f.service.delete('guild-a', 'rules'), 'rules');
  assert.equal(await f.service.get('guild-a', 'rules'), null);
  assert.equal((await f.service.get('guild-b', 'rules')).content, 'Different server');
});

test('custom command limits reject invalid names, empty or long responses, and more than 50 entries', async () => {
  const f = fixture();
  await assert.rejects(f.service.add('guild-a', '@everyone', 'hi', 'admin'), /Names must/);
  await assert.rejects(f.service.add('guild-a', 'okay', ' ', 'admin'), /Responses must/);
  await assert.rejects(f.service.add('guild-a', 'okay', 'x'.repeat(1801), 'admin'), /Responses must/);
  for (let index = 0; index < 50; index++) f.rows.set(`guild-a:cmd${index}`, { guildId: 'guild-a', name: `cmd${index}`, content: 'hi' });
  await assert.rejects(f.service.add('guild-a', 'more', 'hi', 'admin'), /50 custom-command limit/);
  assert.ok(CustomCommandError);
});

test('member command suppresses mentions and admin responses stay private', async () => {
  const f = fixture();
  const create = interaction('add', { name: 'hello', response: '@everyone Welcome!' });
  await adminCommand.execute(create, f.service);
  assert.equal(create.calls[0][1].flags, MessageFlags.Ephemeral);
  assert.match(create.calls[1][1].content, /created/);
  const list = interaction('list');
  await memberCommand.execute(list, f.service);
  assert.match(list.calls[0][1].content, /`hello`/);
  const calls = [];
  const run = { guildId: 'guild-a', commandName: 'hello', isChatInputCommand: () => true,
    client: { commands: new Map(commands.map(command => [command.data.name, command])) },
    deferReply: async () => calls.push(['defer']), editReply: async payload => calls.push(['edit', payload]) };
  await dispatch(run, { isEnabled: async () => true }, f.service);
  assert.equal(calls[1][1].content, '@everyone Welcome!');
  assert.deepEqual(calls[1][1].allowedMentions, { parse: [] });
  const remove = interaction('delete', { name: 'hello' });
  await adminCommand.execute(remove, f.service);
  assert.match(remove.calls[1][1].content, /deleted/);
  assert.equal(memberCommand.data.toJSON().dm_permission, false);
  const management = commands.find(command => command.data.name === 'command').data.toJSON();
  assert.deepEqual(management.options.map(option => option.name), ['add', 'edit', 'delete', 'list', 'sync']);
});

test('disabled customCommands module blocks member execution', async () => {
  let ran = false;
  const calls = [];
  const mock = { commandName: 'commands', guildId: 'guild-a', isChatInputCommand: () => true,
    client: { commands: new Map(commands.map(command => [command.data.name, { ...command, execute: async () => { ran = true; } }])) },
    deferReply: async value => calls.push(['defer', value]), editReply: async value => calls.push(['edit', value]) };
  await dispatch(mock, { isEnabled: async () => false });
  assert.equal(ran, false);
  assert.match(calls[1][1].content, /customCommands.*disabled/);
});

test('saved names register as direct guild slash commands alongside built-ins', async () => {
  const f = fixture();
  await f.service.add('guild-a', 'rules', 'Read the rules', 'admin-a');
  const definitions = await guildCommandDefinitions('guild-a', f.service);
  const direct = definitions.find(command => command.name === 'rules');
  assert.ok(direct);
  assert.equal(direct.type, 1);
  assert.equal(direct.options?.length ?? 0, 0);
  assert.ok(definitions.some(command => command.name === 'health'));
  assert.ok(!definitions.some(command => command.name === 'moxie' || command.name === 'cmd'));
  let registered;
  await syncGuildCommands({ id: 'guild-a', commands: { set: async value => { registered = value; } } }, f.service);
  assert.equal(registered.length, definitions.length);
});

test('built-in names cannot be replaced by a saved response', async () => {
  const f = fixture();
  const add = interaction('add', { name: 'ping', response: 'Not really pong' });
  await adminCommand.execute(add, f.service);
  assert.match(add.calls.at(-1)[1].content, /reserved/);
  assert.equal(await f.service.get('guild-a', 'ping'), null);
  f.rows.set('guild-a:health', { guildId: 'guild-a', name: 'health', content: 'bad' });
  await assert.rejects(guildCommandDefinitions('guild-a', f.service), /conflicts/);
});

test('direct saved commands honor the per-guild module switch', async () => {
  const f = fixture();
  await f.service.add('guild-a', 'rules', 'Read the rules', 'admin-a');
  const calls = [];
  await dispatch({ guildId: 'guild-a', commandName: 'rules', isChatInputCommand: () => true,
    client: { commands: new Map() }, deferReply: async () => calls.push('defer'),
    editReply: async value => calls.push(value) }, { isEnabled: async () => false }, f.service);
  assert.match(calls[1].content, /disabled/);
});
