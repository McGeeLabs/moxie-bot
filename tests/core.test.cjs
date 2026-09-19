const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { commands, collectCommands } = require('../dist/modules');
const { execute: dispatch } = require('../dist/core/events/interactionCreate');
const { execute: health } = require('../dist/modules/admin/health');
const { readRuntimeConfig, readDeploymentConfig } = require('../dist/core/config');
const { logger } = require('../dist/core/logger');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function interaction(overrides = {}) {
  const calls = [];
  return {
    calls, commandName: 'ping', guildId: '123456789012345678', replied: false, deferred: false,
    isChatInputCommand: () => true,
    client: { commands: new Map(commands.map(command => [command.data.name, command])) },
    reply: async payload => { calls.push(['reply', payload]); },
    deferReply: async payload => { calls.push(['defer', payload]); },
    editReply: async payload => { calls.push(['edit', payload]); },
    followUp: async payload => { calls.push(['followUp', payload]); },
    ...overrides,
  };
}

test('startup and deployment fail cleanly without secrets and without contacting Discord', () => {
  for (const script of ['index.js', 'deploy-commands.js']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, '../dist', script)], {
      env: { ...process.env, DISCORD_TOKEN: '', DOTENV_CONFIG_PATH: path.join(__dirname, 'nonexistent.env') },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing env var: DISCORD_TOKEN/);
    assert.doesNotMatch(result.stderr, /UnhandledPromiseRejection/);
  }
});

test('runtime only needs a token; deployment validates IDs without exposing values', () => {
  assert.deepEqual(readRuntimeConfig({ DISCORD_TOKEN: ' test ' }), { token: 'test' });
  assert.throws(() => readRuntimeConfig({}), /Missing env var: DISCORD_TOKEN/);
  assert.throws(() => readDeploymentConfig({ DISCORD_TOKEN: 'test' }), /DISCORD_CLIENT_ID/);
  assert.throws(() => readDeploymentConfig({ DISCORD_TOKEN: 'test', DISCORD_CLIENT_ID: 'invalid', DISCORD_GUILD_ID: '123456789012345678' }), /must be a Discord ID/);
  assert.equal(readDeploymentConfig({ DISCORD_TOKEN: 'test', DISCORD_CLIENT_ID: '123456789012345678', DISCORD_GUILD_ID: '223456789012345678' }).guildId, '223456789012345678');
});

test('registry serializes all commands and rejects name collisions', () => {
  assert.deepEqual(commands.map(command => command.data.toJSON().name).sort(), ['about', 'ban', 'case', 'cases', 'command', 'commands', 'health', 'kick', 'moderation', 'module', 'modules', 'ping', 'reason', 'timeout', 'untimeout', 'valheim', 'warn', 'warnings', 'webhook']);
  assert.throws(() => collectCommands([{ name: 'duplicate', commands: [commands[0], commands[0]] }]), /Duplicate command: ping/);
});

test('ping replies and edits latency successfully in two guilds', async () => {
  for (const guildId of ['123456789012345678', '223456789012345678']) {
    const mock = interaction({ guildId });
    await dispatch(mock);
    assert.match(mock.calls[0][1].content, /Pong!/);
    assert.match(mock.calls[1][1], /Pong!.*\d+ms/);
  }
});

test('non-command interactions are ignored and stale commands receive a reply', async () => {
  const ignored = interaction({ isChatInputCommand: () => false });
  await dispatch(ignored);
  assert.equal(ignored.calls.length, 0);
  const stale = interaction({ commandName: 'removed' });
  await dispatch(stale, undefined, { get: async () => null });
  assert.equal(stale.calls[0][1].flags, MessageFlags.Ephemeral);
});

test('command errors use the appropriate response for each acknowledgement state', async () => {
  for (const [state, method] of [[{}, 'reply'], [{ deferred: true }, 'edit'], [{ replied: true }, 'followUp']]) {
    const mock = interaction({ ...state, client: { commands: new Map([['ping', { execute: async () => { throw new Error('test failure'); } }]]) } });
    await dispatch(mock);
    assert.equal(mock.calls[0][0], method);
    assert.match(mock.calls[0][1].content, /Command failed/);
  }
});

test('a failed error response does not escape the handler', async () => {
  const mock = interaction({
    client: { commands: new Map([['ping', { execute: async () => { throw new Error('test failure'); } }]]) },
    reply: async () => { throw new Error('expired interaction'); },
  });
  await assert.doesNotReject(() => dispatch(mock));
});

test('health enforces permissions in guilds and rejects DMs', async () => {
  for (const inGuild of [true, false]) {
    const mock = interaction({ inGuild: () => inGuild, memberPermissions: { has: () => false } });
    await health(mock);
    assert.match(mock.calls[0][1].content, /requires Administrator/);
    assert.equal(mock.calls[0][1].flags, MessageFlags.Ephemeral);
  }
  const mock = interaction({
    inGuild: () => true,
    memberPermissions: { has: permission => permission === PermissionFlagsBits.Administrator },
    client: { isReady: () => true, ws: { ping: -1 } },
  });
  const previousUrl = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    await health(mock);
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
  assert.match(mock.calls[1][1].content, /Discord: Ready/);
  assert.match(mock.calls[1][1].content, /Not available yet/);
  assert.match(mock.calls[1][1].content, /Database: Not configured/);
  assert.equal(mock.calls[0][1].flags, MessageFlags.Ephemeral);
});

test('JSON logs redact the configured Discord token from errors and metadata', () => {
  const previousToken = process.env.DISCORD_TOKEN;
  const previousError = console.error;
  let output;
  try {
    process.env.DISCORD_TOKEN = 'secret-test-token';
    console.error = value => { output = value; };
    logger.error('failure', new Error('secret-test-token'), { detail: 'secret-test-token' });
    const entry = JSON.parse(output);
    assert.equal(entry.level, 'error');
    assert.equal(entry.detail, '[REDACTED]');
    assert.ok(!output.includes('secret-test-token'));
  } finally {
    console.error = previousError;
    if (previousToken === undefined) delete process.env.DISCORD_TOKEN;
    else process.env.DISCORD_TOKEN = previousToken;
  }
});

const { checkDatabase, disconnectDatabase } = require('../dist/core/database');

test('database health handles missing and invalid URLs without exposing credentials', async () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousWarn = console.warn;
  const warnings = [];
  try {
    delete process.env.DATABASE_URL;
    assert.deepEqual(await checkDatabase(), { status: 'not_configured' });
    process.env.DATABASE_URL = 'invalid-connection-secret';
    console.warn = value => warnings.push(value);
    assert.deepEqual(await checkDatabase(), { status: 'unavailable' });
    assert.ok(warnings.length > 0);
    assert.ok(warnings.every(value => !value.includes('invalid-connection-secret')));
  } finally {
    await disconnectDatabase();
    console.warn = previousWarn;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
