const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MESSAGES, t, tm } = require('../src/renderer/i18n');

const SRC = path.join(__dirname, '..', 'src');

test('all languages have the same keys and placeholders', () => {
  const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  const en = MESSAGES.en;
  for (const [lang, dict] of Object.entries(MESSAGES)) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), `${lang} keys`);
    for (const key of Object.keys(en)) assert.equal(placeholders(dict[key]), placeholders(en[key]), `${lang} ${key}`);
  }
});

test('every key used in source exists', () => {
  const files = ['engine.js', 'draft.js', 'main.js', 'renderer/renderer.js'];
  const used = new Set();
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const m of code.matchAll(/'((?:status|meta|game|reason|draft|app|footer|tray|update|rules)\.[\w.]+)'/g)) used.add(m[1]);
  }
  // Dynamic keys built from known values.
  for (const flag of ['healing', 'burst', 'cc', 'crit', 'highArmor', 'highMR', 'heavyAD', 'heavyAP']) {
    used.add(`reason.counter.${flag}`);
    used.add(`flag.${flag}`);
  }
  for (const a of ['mage', 'enchanter', 'marksman', 'assassin', 'fighter', 'tank']) used.add(`archetype.${a}`);
  for (const r of ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']) used.add(`role.${r}`).add(`roleIn.${r}`);
  used.add('roleIn.ALL');

  const missing = [...used].filter((k) => !(k in MESSAGES.en));
  assert.deepEqual(missing, []);
});

test('formats params, nested keys and signed numbers per language', () => {
  const reason = {
    key: 'draft.base',
    params: { wr: { num: 53.27 }, role: { key: 'roleIn.MIDDLE' }, games: 1200 },
  };
  assert.equal(tm('en', reason), '53.3% WR mid (1,200 games)');
  assert.equal(tm('pt-BR', reason), '53,3% de vitória no meio (1.200 partidas)');

  const vs = { key: 'draft.vs', params: { delta: { num: 1.25, sign: true }, name: 'Zed' } };
  assert.equal(tm('pt-BR', vs), '+1,3% contra Zed');
  assert.equal(t('pt-BR', 'unknown.key'), 'unknown.key');
});
