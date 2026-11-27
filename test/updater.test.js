const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater, FIRST_CHECK_MS, CHECK_EVERY_MS } = require('../src/updater');

function fakeTimers() {
  const scheduled = [];
  return {
    scheduled,
    setTimeout: (fn, ms) => scheduled.push({ fn, ms, type: 'timeout' }) - 1,
    setInterval: (fn, ms) => scheduled.push({ fn, ms, type: 'interval' }) - 1,
    clearTimeout: (i) => (scheduled[i].cleared = true),
    clearInterval: (i) => (scheduled[i].cleared = true),
  };
}

function fakeAutoUpdater() {
  const u = new EventEmitter();
  u.checks = 0;
  u.installs = [];
  u.checkForUpdates = async () => { u.checks += 1; };
  u.quitAndInstall = (...args) => u.installs.push(args);
  return u;
}

test('disabled in development: never loads electron-updater', () => {
  let loaded = false;
  const up = createUpdater({ enabled: false, loadUpdater: () => { loaded = true; } });
  assert.equal(loaded, false);
  assert.equal(up.get().state, 'idle');
  assert.equal(up.install(), false);
});

test('schedules checks and walks through download states', async () => {
  const timers = fakeTimers();
  const au = fakeAutoUpdater();
  const states = [];
  const up = createUpdater({ enabled: true, loadUpdater: () => au, onChange: (s) => states.push(s.state), timers });

  assert.equal(au.autoDownload, true);
  assert.equal(au.autoInstallOnAppQuit, true);
  assert.deepEqual(timers.scheduled.map((s) => [s.type, s.ms]), [['timeout', FIRST_CHECK_MS], ['interval', CHECK_EVERY_MS]]);

  await timers.scheduled[0].fn();
  assert.equal(au.checks, 1);

  assert.equal(up.install(), false, 'nothing to install yet');
  au.emit('checking-for-update');
  au.emit('update-available', { version: '0.2.0' });
  au.emit('download-progress', { percent: 42.4 });
  assert.deepEqual(up.get(), { state: 'downloading', version: '0.2.0', percent: 42 });

  await up.check();
  assert.equal(au.checks, 1, 'no new check while downloading');

  au.emit('update-downloaded', { version: '0.2.0' });
  assert.deepEqual(up.get(), { state: 'ready', version: '0.2.0' });
  assert.deepEqual(states, ['checking', 'downloading', 'downloading', 'ready']);

  au.emit('error', new Error('network'));
  assert.equal(up.get().state, 'ready', 'a later error keeps the downloaded update');

  assert.equal(up.install(), true);
  assert.deepEqual(au.installs, [[false, true]]);

  up.stop();
  assert.ok(timers.scheduled.every((s) => s.cleared));
});

test('errors before download return to idle quietly', async () => {
  const au = fakeAutoUpdater();
  au.checkForUpdates = async () => { throw new Error('offline'); };
  const up = createUpdater({ enabled: true, loadUpdater: () => au, timers: fakeTimers() });
  const origError = console.error;
  console.error = () => {};
  try {
    await up.check();
    au.emit('error', new Error('offline'));
  } finally {
    console.error = origError;
  }
  assert.equal(up.get().state, 'idle');
});
