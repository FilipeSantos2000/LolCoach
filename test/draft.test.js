const { test } = require('node:test');
const assert = require('node:assert/strict');
const { suggestChampions } = require('../src/draft');
const { parseLockfile, parseCommandLine } = require('../src/lcu');
const { emptyMeta, addMatch } = require('../src/meta/store');

const champ = (id, key, tags, attack, magic) => ({ id, key: String(key), name: id, tags, info: { attack, magic }, image: { full: `${id}.png` } });
const data = {
  version: 't',
  champions: {
    Ahri: champ('Ahri', 103, ['Mage', 'Assassin'], 3, 8),
    Syndra: champ('Syndra', 134, ['Mage'], 2, 9),
    Yasuo: champ('Yasuo', 157, ['Fighter', 'Assassin'], 8, 4),
    Zed: champ('Zed', 238, ['Assassin'], 9, 1),
    Garen: champ('Garen', 86, ['Fighter', 'Tank'], 7, 1),
    Caitlyn: champ('Caitlyn', 51, ['Marksman'], 8, 2),
    Leona: champ('Leona', 89, ['Tank', 'Support'], 4, 3),
  },
};

const session = (myPicks, enemyPicks) => ({
  localPlayerCellId: 0,
  myTeam: [{ cellId: 0, assignedPosition: 'middle', championId: 0 }, ...myPicks.map((k, i) => ({ cellId: i + 1, championId: k }))],
  theirTeam: enemyPicks.map((k, i) => ({ cellId: i + 5, championId: k })),
});

test('parses LCU credentials', () => {
  assert.deepEqual(parseLockfile('LeagueClient:1234:54321:s3cr3t:https'), { port: 54321, password: 's3cr3t' });
  assert.deepEqual(
    parseCommandLine('"LeagueClientUx.exe" "--remoting-auth-token=abc_DEF-1" "--app-port=60000"'),
    { port: 60000, password: 'abc_DEF-1' }
  );
  assert.equal(parseLockfile('garbage'), null);
  assert.equal(parseCommandLine(''), null);
});

test('addMatch records lane matchups and synergies', () => {
  const meta = emptyMeta('16.23');
  const p = (championName, teamId, teamPosition, win) => ({ championName, teamId, teamPosition, win });
  addMatch(meta, { info: { participants: [
    p('Ahri', 100, 'MIDDLE', true), p('Garen', 100, 'TOP', true),
    p('Zed', 200, 'MIDDLE', false), p('Caitlyn', 200, 'BOTTOM', false),
  ] } }, (n) => n);
  assert.deepEqual(meta.champions.Ahri.MIDDLE.vs, { Zed: [1, 1] });
  assert.deepEqual(meta.champions.Ahri.MIDDLE.with, { Garen: [1, 1] });
  assert.deepEqual(meta.champions.Zed.MIDDLE.vs, { Ahri: [1, 0] });
  assert.equal(meta.champions.Ahri.ALL.vs, undefined);
});

test('without meta, suggests role-fitting champions and balances damage', () => {
  // Allies all AD -> AP mids first.
  const r = suggestChampions({ session: session([86, 51], []), data });
  assert.equal(r.role, 'MIDDLE');
  assert.ok(r.picks.every((p) => ['Ahri', 'Syndra', 'Zed', 'Yasuo'].includes(p.id)), 'mid-lane tags only');
  assert.ok(!r.picks.some((p) => ['Leona', 'Garen', 'Caitlyn'].includes(p.id)));
  assert.ok(['Ahri', 'Syndra'].includes(r.picks[0].id));
  assert.ok(r.picks[0].reasons.some((x) => x.key === 'draft.addsAP'));
  assert.equal(r.hasMeta, false);
});

test('with meta, matchup against likely lane opponent changes the pick', () => {
  const bucket = (games, wins, vs = {}, extra = {}) => ({ games, wins, items: {}, vs, with: {}, ...extra });
  const meta = {
    champions: {
      Ahri: { MIDDLE: bucket(400, 208, { Zed: [80, 30] }), ALL: bucket(400, 208) },
      Syndra: { MIDDLE: bucket(400, 200, { Zed: [80, 52] }), ALL: bucket(400, 200) },
      Yasuo: { TOP: bucket(300, 150), ALL: bucket(300, 150) }, // not played mid
      Zed: { MIDDLE: bucket(500, 250), ALL: bucket(500, 250) },
    },
  };

  const noEnemy = suggestChampions({ session: session([], []), data, meta });
  assert.equal(noEnemy.picks[0].id, 'Ahri', 'higher base win rate');
  assert.ok(!noEnemy.picks.some((p) => p.id === 'Yasuo'), 'champions without role data are skipped');

  const vsZed = suggestChampions({ session: session([], [238]), data, meta });
  assert.equal(vsZed.picks[0].id, 'Syndra');
  assert.ok(vsZed.picks[0].reasons.some((x) => x.key === 'draft.vs' && x.params.name === 'Zed' && x.params.delta.num > 0));
  assert.ok(!vsZed.picks.some((p) => p.id === 'Zed'), 'picked champions excluded');
});

test('only suggests pickable champions', () => {
  const r = suggestChampions({ session: session([], []), data, pickableIds: [134] });
  assert.deepEqual(r.picks.map((p) => p.id), ['Syndra']);
});
