const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RiotClient, RateLimiter, RiotAuthError } = require('../src/meta/riot');
const { patchOf, selectMeta, saveMeta, emptyMeta, loadMeta } = require('../src/meta/store');
const { collect } = require('../src/meta/collector');
const { recommend } = require('../src/engine');

const created = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lolcoach-test-'));
  created.push(dir);
  return dir;
};
after(() => created.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const participant = (championName, teamPosition, win, items) => {
  const p = { championName, teamPosition, win };
  items.forEach((id, i) => (p[`item${i}`] = id));
  return p;
};

const makeMatch = (version, created, participants) => ({
  info: { gameVersion: version, gameCreation: created, participants },
});

test('patchOf normalises versions', () => {
  assert.equal(patchOf('16.23.1'), '16.23');
  assert.equal(patchOf('16.23.712.4321'), '16.23');
});

test('rate limiter waits when a window is full', async () => {
  let t = 0;
  const waits = [];
  const limiter = new RateLimiter({ limits: [[2, 1000]], now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  await limiter.acquire();
  await limiter.acquire();
  await limiter.acquire();
  assert.equal(waits.length, 1);
  assert.ok(t >= 1000);
});

test('client throws auth error on 401 and retries on 429', async () => {
  const noLimit = { acquire: async () => {} };
  const res = (status, body, headers = {}) => ({
    ok: status === 200, status, json: async () => body, headers: { get: (h) => headers[h] },
  });

  const bad = new RiotClient({ apiKey: 'x', fetchImpl: async () => res(401), limiter: noLimit, sleep: async () => {} });
  await assert.rejects(() => bad.match('EUW1_1'), RiotAuthError);

  const calls = [];
  const replies = [res(429, null, { 'retry-after': '1' }), res(200, { ok: true })];
  const slept = [];
  const flaky = new RiotClient({
    apiKey: 'x',
    fetchImpl: async (url, opts) => { calls.push([url, opts.headers['X-Riot-Token']]); return replies.shift(); },
    limiter: noLimit,
    sleep: async (ms) => slept.push(ms),
  });
  assert.deepEqual(await flaky.match('EUW1_1'), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(slept[0], 1000);
  assert.ok(calls[0][0].startsWith('https://europe.api.riotgames.com/lol/match/v5/matches/'));
  assert.equal(calls[0][1], 'x');
});

test('collector aggregates current patch, skips older, and resumes without duplicates', async () => {
  const dir = tmpDir();
  const matches = {
    M3: makeMatch('16.23.700.1', 3000, [participant('Ahri', 'MIDDLE', true, [3157, 3020, 0])]),
    M2: makeMatch('16.23.700.1', 2000, [participant('ahri', 'MIDDLE', false, [3157])]),
    M1: makeMatch('16.22.600.1', 1000, [participant('Ahri', 'MIDDLE', true, [3089])]),
  };
  const requested = [];
  const client = {
    highEloPuuids: async () => ['p1', 'p2'],
    matchIds: async () => ['M3', 'M2', 'M1'],
    match: async (id) => { requested.push(id); return matches[id]; },
  };
  const champIdOf = (n) => (n.toLowerCase() === 'ahri' ? 'Ahri' : null);

  const meta = await collect({ client, dir, patch: '16.23', champIdOf, now: () => 0 });
  assert.equal(meta.matches, 2);
  assert.equal(meta.champions.Ahri.MIDDLE.games, 2);
  assert.equal(meta.champions.Ahri.MIDDLE.wins, 1);
  assert.deepEqual(meta.champions.Ahri.ALL.items['3157'], [2, 1]);
  assert.equal(meta.champions.Ahri.ALL.items['3089'], undefined, 'older patch ignored');
  assert.equal(meta.floor, 1001, 'floor raised past older-patch game');
  assert.deepEqual(requested, ['M3', 'M2', 'M1'], 'second player re-uses seen ids');

  // Resume: nothing new to fetch, counts unchanged.
  const again = await collect({ client, dir, patch: '16.23', champIdOf, now: () => 0, target: 10 });
  assert.equal(again.matches, 2);
  assert.equal(loadMeta(dir, '16.23').matches, 2);
});

test('collector stops when aborted', async () => {
  const dir = tmpDir();
  const ac = new AbortController();
  const client = {
    highEloPuuids: async () => ['p1'],
    matchIds: async () => ['A', 'B'],
    match: async () => { ac.abort(); return makeMatch('16.23.1', 1, []); },
  };
  const meta = await collect({ client, dir, patch: '16.23', champIdOf: () => null, signal: ac.signal, now: () => 0 });
  assert.equal(meta.matches, 1);
  assert.equal(meta.cursor, 0, 'cursor kept so the player is resumed');
});

test('selectMeta falls back to previous patch until enough matches', () => {
  const dir = tmpDir();
  const old = emptyMeta('16.22');
  old.matches = 500;
  saveMeta(dir, old);
  const cur = emptyMeta('16.23');
  cur.matches = 50;
  saveMeta(dir, cur);

  let sel = selectMeta(dir, '16.23', 200);
  assert.equal(sel.meta.patch, '16.22');
  assert.equal(sel.stale, true);

  cur.matches = 250;
  saveMeta(dir, cur);
  sel = selectMeta(dir, '16.23', 200);
  assert.equal(sel.meta.patch, '16.23');
  assert.equal(sel.stale, false);

  assert.equal(selectMeta(tmpDir(), '16.23').meta, null);
});

test('engine uses meta pick rates, even for off-archetype items', () => {
  const sr = { 11: true };
  const item = (name, total, tags, extra = {}) => ({ name, tags, maps: sr, gold: { total, purchasable: true }, stats: {}, ...extra });
  const data = {
    version: 't',
    champions: { Kayle: { id: 'Kayle', name: 'Kayle', tags: ['Fighter', 'Support'], info: { attack: 6, magic: 7 } } },
    items: {
      1001: item('Boots', 300, ['Boots']),
      3006: item("Berserker's Greaves", 1100, ['Boots', 'AttackSpeed'], { from: ['1001'] }),
      3020: item("Sorcerer's Shoes", 1100, ['Boots', 'MagicPenetration'], { from: ['1001'] }),
      3115: item("Nashor's Tooth", 3000, ['SpellDamage', 'AttackSpeed', 'OnHit']),
      3089: item("Rabadon's Deathcap", 3500, ['SpellDamage']),
      3031: item('Infinity Edge', 3450, ['Damage', 'CriticalStrike']),
    },
  };
  const game = {
    activePlayer: { riotId: 'Me#T', currentGold: 0 },
    allPlayers: [{ riotId: 'Me#T', rawChampionName: 'game_character_displayname_Kayle', team: 'ORDER', position: 'TOP', items: [] }],
    gameData: { mapNumber: 11 },
  };
  const meta = {
    champions: {
      Kayle: {
        TOP: { games: 100, wins: 52, items: { 3115: [90, 50], 3031: [40, 22], 3006: [80, 42] } },
        ALL: { games: 100, wins: 52, items: {} },
      },
    },
  };

  const r = recommend(game, data, { meta });
  assert.equal(r.items[0].id, '3115');
  assert.deepEqual(r.items[0].reasons[0], { key: 'reason.meta', params: { pick: 90, wr: 56 } });
  assert.ok(r.items.some((i) => i.id === '3031'), 'popular off-archetype item allowed');
  assert.equal(r.boots.id, '3006');
  assert.equal(r.metaGames, 100);

  const rulesOnly = recommend(game, data);
  assert.ok(!rulesOnly.items.some((i) => i.id === '3031'));
  assert.equal(rulesOnly.metaGames, 0);
});

test('buildOrders keeps first 3 completed items, honouring undo and re-buys', () => {
  const { buildOrders } = require('../src/meta/store');
  const core = new Set([3157, 3089, 6655, 3135, 3165]);
  const ev = (type, participantId, extra, timestamp) => ({ type, participantId, timestamp, ...extra });
  const timeline = { info: { frames: [
    { events: [
      ev('ITEM_PURCHASED', 1, { itemId: 1056 }, 10), // starter, not core
      ev('ITEM_PURCHASED', 1, { itemId: 3089 }, 20),
      ev('ITEM_UNDO', 1, { beforeId: 3089, afterId: 0 }, 21),
      ev('ITEM_PURCHASED', 2, { itemId: 3165 }, 25),
    ] },
    { events: [
      ev('ITEM_PURCHASED', 1, { itemId: 6655 }, 30),
      ev('ITEM_PURCHASED', 1, { itemId: 3157 }, 40),
      ev('ITEM_PURCHASED', 1, { itemId: 6655 }, 45), // re-buy after selling
      ev('ITEM_PURCHASED', 1, { itemId: 3089 }, 50),
      ev('ITEM_PURCHASED', 1, { itemId: 3135 }, 60), // 4th, dropped
    ] },
  ] } };

  const orders = buildOrders(timeline, (id) => core.has(id));
  assert.deepEqual(orders.get(1), [6655, 3157, 3089]);
  assert.deepEqual(orders.get(2), [3165]);
});

test('collector fetches timelines and stores build order per slot', async () => {
  const dir = tmpDir();
  const p = (participantId, championName, win) => ({ participantId, championName, teamId: 100, teamPosition: 'MIDDLE', win });
  const client = {
    highEloPuuids: async () => ['p1'],
    matchIds: async () => ['M1'],
    match: async () => makeMatch('16.23.1', 1, [p(1, 'Ahri', true)]),
    matchTimeline: async () => ({ info: { frames: [{ events: [
      { type: 'ITEM_PURCHASED', participantId: 1, itemId: 6655, timestamp: 1 },
      { type: 'ITEM_PURCHASED', participantId: 1, itemId: 3157, timestamp: 2 },
    ] }] } }),
  };
  const meta = await collect({
    client, dir, patch: '16.23', champIdOf: (n) => n, now: () => 0, isCoreItem: (id) => id > 3000,
  });
  assert.deepEqual(meta.champions.Ahri.MIDDLE.order, { 1: { 6655: [1, 1] }, 2: { 3157: [1, 1] } });
  assert.deepEqual(meta.champions.Ahri.ALL.order, { 1: { 6655: [1, 1] }, 2: { 3157: [1, 1] } });
});

test('engine prefers the usual item for the next build slot', () => {
  const sr = { 11: true };
  const item = (name, tags) => ({ name, tags, maps: sr, gold: { total: 3000, purchasable: true }, stats: {} });
  const data = {
    version: 't',
    champions: { Ahri: { id: 'Ahri', name: 'Ahri', tags: ['Mage'], info: { attack: 3, magic: 8 } } },
    items: { 6655: item('Luden', ['SpellDamage']), 3157: item('Zhonya', ['SpellDamage']), 3089: item('Deathcap', ['SpellDamage']) },
  };
  const bucket = {
    games: 100, wins: 50,
    items: { 6655: [90, 45], 3157: [90, 45], 3089: [90, 45] }, // equal overall pick
    order: { 1: { 6655: [80, 40], 3157: [20, 10] }, 2: { 3157: [70, 35], 3089: [30, 15] }, 3: { 3089: [60, 30] } },
  };
  const meta = { champions: { Ahri: { MIDDLE: bucket, ALL: bucket } } };
  const game = (items) => ({
    activePlayer: { riotId: 'Me#T', currentGold: 0 },
    allPlayers: [{ riotId: 'Me#T', rawChampionName: 'game_character_displayname_Ahri', team: 'ORDER', position: 'MIDDLE', items: items.map((itemID) => ({ itemID })) }],
    gameData: { mapNumber: 11 },
  });

  const first = recommend(game([]), data, { meta });
  assert.equal(first.items[0].id, '6655');
  assert.deepEqual(first.items[0].reasons[0], { key: 'reason.order', params: { slot: 1, pick: 80 } });

  const second = recommend(game([6655]), data, { meta });
  assert.equal(second.items[0].id, '3157');
  assert.equal(second.items[0].reasons[0].params.slot, 2);
});
