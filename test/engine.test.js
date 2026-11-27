const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recommend, getArchetype, championIdFromPlayer } = require('../src/engine');

const sr = { 11: true };
const champ = (id, tags, attack, magic) => ({ id, name: id, tags, info: { attack, magic } });
const item = (name, total, tags, extra = {}) => ({
  name, tags, maps: sr, gold: { total, purchasable: true }, stats: {}, ...extra,
});

const data = {
  version: 'test',
  champions: {
    Ahri: champ('Ahri', ['Mage', 'Assassin'], 3, 8),
    Zed: champ('Zed', ['Assassin'], 9, 1),
    Talon: champ('Talon', ['Assassin'], 9, 1),
    Darius: champ('Darius', ['Fighter', 'Tank'], 9, 1),
    Soraka: champ('Soraka', ['Support', 'Mage'], 2, 7),
    Aatrox: champ('Aatrox', ['Fighter'], 8, 3),
  },
  items: {
    1001: item('Boots', 300, ['Boots'], { into: ['3020', '3047'] }),
    1058: item('Large Rod', 1200, ['SpellDamage'], { into: ['3089'] }),
    3020: item("Sorcerer's Shoes", 1100, ['Boots', 'MagicPenetration'], { from: ['1001'] }),
    3047: item('Plated Steelcaps', 1200, ['Boots', 'Armor'], { from: ['1001'] }),
    3089: item("Rabadon's Deathcap", 3500, ['SpellDamage'], { from: ['1058'] }),
    3157: item("Zhonya's Hourglass", 3250, ['SpellDamage', 'Armor', 'Active']),
    3165: item('Morellonomicon', 2950, ['SpellDamage', 'Health']),
    3031: item('Infinity Edge', 3450, ['Damage', 'CriticalStrike']),
  },
};

const player = (name, champion, team, items = [], kills = 0) => ({
  riotId: `${name}#T`, summonerName: name, championName: champion,
  rawChampionName: `game_character_displayname_${champion}`, team,
  items: items.map((itemID) => ({ itemID })), scores: { kills, deaths: 0 },
});

const game = (myItems, enemies) => ({
  activePlayer: { riotId: 'Me#T', summonerName: 'Me', currentGold: 3000 },
  allPlayers: [player('Me', 'Ahri', 'ORDER', myItems), ...enemies.map((c, i) => player(`E${i}`, c, 'CHAOS'))],
  gameData: { mapNumber: 11 },
});

test('detects archetypes', () => {
  assert.equal(getArchetype(data.champions.Ahri), 'mage');
  assert.equal(getArchetype(data.champions.Zed), 'assassin');
  assert.equal(getArchetype(data.champions.Soraka), 'enchanter');
});

test('resolves champion id from raw name', () => {
  assert.equal(championIdFromPlayer({ rawChampionName: 'game_character_displayname_Zed' }, data.champions), 'Zed');
});

test('never recommends off-archetype or owned items', () => {
  const r = recommend(game([3089], ['Zed']), data);
  const ids = r.items.map((i) => i.id);
  assert.ok(!ids.includes('3031'), 'mage should not get Infinity Edge');
  assert.ok(!ids.includes('3089'), 'owned item should be skipped');
});

test('prioritises Grievous Wounds vs healers', () => {
  const r = recommend(game([], ['Soraka', 'Aatrox']), data);
  assert.ok(r.threats.flags.includes('healing'));
  assert.equal(r.items[0].id, '3165');
});

test('prioritises Zhonya and Steelcaps vs AD burst', () => {
  const r = recommend(game([], ['Zed', 'Talon', 'Darius']), data);
  assert.ok(r.threats.flags.includes('burst'));
  assert.ok(r.threats.flags.includes('heavyAD'));
  assert.equal(r.items[0].id, '3157');
  assert.equal(r.boots.id, '3047');
});

test('boosts items that build from owned components', () => {
  const r = recommend(game([1058], ['Soraka']), data);
  const deathcap = r.items.find((i) => i.id === '3089');
  assert.ok(deathcap.reasons.some((x) => x.key === 'reason.buildsFrom' && x.params.item === 'Large Rod'));
});

test('skips boots when already owned', () => {
  const r = recommend(game([3020], ['Zed']), data);
  assert.equal(r.boots, null);
});

const { RUNE, analyzeEnemies } = require('../src/engine');
const withRune = (p, id, displayName = 'Rune') => ({ ...p, runes: { keystone: { id, displayName } } });

test('enemy keystones add healing and burst threats', () => {
  // One Aatrox alone (healer = 1) stays below the healing threshold...
  const aatrox = player('E0', 'Aatrox', 'CHAOS');
  assert.equal(analyzeEnemies([aatrox], data).flags.healing, false);
  // ...but with Conqueror it crosses it.
  assert.equal(analyzeEnemies([withRune(aatrox, RUNE.CONQUEROR)], data).flags.healing, true);

  const zed = player('E1', 'Zed', 'CHAOS');
  assert.equal(analyzeEnemies([zed], data).flags.burst, false);
  assert.equal(analyzeEnemies([withRune(zed, RUNE.ELECTROCUTE)], data).flags.burst, true);
});

test('my keystone boosts matching stats and explains it', () => {
  const items = {
    ...data.items,
    3135: item('Void Staff', 3000, ['SpellDamage', 'MagicPenetration']),
  };
  const d = { ...data, items };
  const g = game([], ['Soraka']);
  g.allPlayers[0] = withRune(g.allPlayers[0], RUNE.ELECTROCUTE, 'Electrocute');

  const plain = recommend(game([], ['Soraka']), d, { count: 10 });
  const withKeystone = recommend(g, d, { count: 10 });
  const score = (r) => r.items.find((i) => i.id === '3135').score;

  assert.ok(score(withKeystone) > score(plain));
  const voidStaff = withKeystone.items.find((i) => i.id === '3135');
  assert.ok(voidStaff.reasons.some((x) => x.key === 'reason.keystone' && x.params.rune === 'Electrocute'));
});
