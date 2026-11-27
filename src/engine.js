// Rules-based item recommendation engine.
// Input: Live Client Data (allgamedata) + Data Dragon static data. Output: next items with reasons.

const RAW_PREFIX = 'game_character_displayname_';

// Item IDs used by counter rules. Missing IDs (patch changes) are skipped automatically.
const ITEM = {
  THORNMAIL: '3075', MORTAL_REMINDER: '3033', MORELLONOMICON: '3165', CHEMPUNK: '6609', PUTRIFIER: '3011',
  ZHONYAS: '3157', GUARDIAN_ANGEL: '3026', STERAKS: '3053', BANSHEES: '3102', EDGE_OF_NIGHT: '3814',
  DEATHS_DANCE: '6333', MERCURIAL: '3139', MAW: '3156', WITS_END: '3091', RANDUINS: '3143',
  VOID_STAFF: '3135', SERYLDAS: '6694', LDR: '3036', BLACK_CLEAVER: '3071', FORCE_OF_NATURE: '4401',
  SPIRIT_VISAGE: '3065', KAENIC: '2504',
  STEELCAPS: '3047', MERCS: '3111', SORCS: '3020', BERSERKERS: '3006', IONIAN: '3158',
};

const HEALERS = new Set([
  'Aatrox', 'Vladimir', 'Soraka', 'Sylas', 'DrMundo', 'Warwick', 'Yuumi', 'Fiddlesticks', 'Swain', 'Briar',
  'Olaf', 'Nami', 'Sona', 'Seraphine', 'Illaoi', 'Fiora', 'Samira', 'Senna', 'Kayn', 'Renekton', 'Volibear',
  'Maokai', 'Nasus', 'Trundle', 'Zac', 'Milio', 'Gwen', 'Viego', 'Belveth', 'Udyr', 'Taric', 'Karma',
]);

const HEAVY_CC = new Set([
  'Leona', 'Nautilus', 'Amumu', 'Malphite', 'Sejuani', 'Lissandra', 'Morgana', 'Thresh', 'Rell', 'Ashe',
  'Zyra', 'Annie', 'Veigar', 'Rammus', 'Alistar', 'Maokai', 'Skarner', 'Braum', 'Lux', 'Neeko', 'Galio',
  'Ornn', 'Zac', 'JarvanIV', 'Vi', 'Warwick', 'TwistedFate', 'Sion', 'Poppy', 'Blitzcrank', 'Pyke', 'Rakan',
]);

// How much each Data Dragon item tag matters per archetype.
const TAG_WEIGHTS = {
  mage: { SpellDamage: 3, CooldownReduction: 1.5, Mana: 1, MagicPenetration: 1.5, Health: 0.3 },
  enchanter: { ManaRegen: 2, CooldownReduction: 2, SpellDamage: 1, Health: 0.5, Aura: 1.5, Active: 1 },
  marksman: { Damage: 2.5, AttackSpeed: 2, CriticalStrike: 3, LifeSteal: 1, OnHit: 1 },
  assassin: { Damage: 3, ArmorPenetration: 3, CooldownReduction: 1.5, NonbootsMovement: 0.5 },
  fighter: { Damage: 2, Health: 2, CooldownReduction: 1.5, LifeSteal: 0.5, SpellVamp: 0.5, Armor: 0.5, SpellBlock: 0.5 },
  tank: { Health: 3, Armor: 2, SpellBlock: 2, CooldownReduction: 1, HealthRegen: 0.5, Aura: 1 },
};

// An item must have at least one of these tags to fit the archetype.
const REQUIRED_TAGS = {
  mage: ['SpellDamage'],
  enchanter: ['ManaRegen', 'SpellDamage', 'Aura', 'Health'],
  marksman: ['CriticalStrike', 'AttackSpeed', 'Damage'],
  assassin: ['Damage'],
  fighter: ['Damage', 'Health'],
  tank: ['Health', 'Armor', 'SpellBlock'],
};

// Items with these tags are off-archetype.
const OFF_TAGS = {
  mage: ['Damage', 'CriticalStrike'],
  enchanter: ['Damage', 'CriticalStrike', 'ArmorPenetration'],
  marksman: ['SpellDamage'],
  assassin: ['SpellDamage'],
  fighter: ['SpellDamage', 'CriticalStrike'],
  tank: ['SpellDamage', 'CriticalStrike'],
};

// Counter rules: threat flag -> item(s) per archetype.
// Reasons are translation keys: reason.counter.<flag> (see renderer/i18n.js).
const COUNTERS = [
  { flag: 'healing',
    ids: { mage: [ITEM.MORELLONOMICON], marksman: [ITEM.MORTAL_REMINDER], assassin: [ITEM.CHEMPUNK], fighter: [ITEM.CHEMPUNK], tank: [ITEM.THORNMAIL], enchanter: [ITEM.PUTRIFIER] } },
  { flag: 'burst',
    ids: { mage: [ITEM.ZHONYAS], marksman: [ITEM.GUARDIAN_ANGEL], assassin: [ITEM.EDGE_OF_NIGHT], fighter: [ITEM.STERAKS] } },
  { flag: 'cc', ids: { marksman: [ITEM.MERCURIAL], fighter: [ITEM.STERAKS] } },
  { flag: 'crit', ids: { tank: [ITEM.RANDUINS], fighter: [ITEM.RANDUINS] } },
  { flag: 'highArmor',
    ids: { marksman: [ITEM.LDR], assassin: [ITEM.SERYLDAS], fighter: [ITEM.BLACK_CLEAVER, ITEM.SERYLDAS] } },
  { flag: 'highMR', ids: { mage: [ITEM.VOID_STAFF] } },
  { flag: 'heavyAD',
    ids: { mage: [ITEM.ZHONYAS], tank: [ITEM.THORNMAIL, ITEM.RANDUINS], fighter: [ITEM.DEATHS_DANCE] } },
  { flag: 'heavyAP',
    ids: { mage: [ITEM.BANSHEES], tank: [ITEM.FORCE_OF_NATURE, ITEM.KAENIC], fighter: [ITEM.MAW, ITEM.SPIRIT_VISAGE, ITEM.WITS_END], marksman: [ITEM.MAW], assassin: [ITEM.MAW] } },
];

const COUNTER_BONUS = 5;

function championIdFromPlayer(player, champions) {
  const raw = player.rawChampionName || '';
  const id = raw.startsWith(RAW_PREFIX) ? raw.slice(RAW_PREFIX.length) : null;
  if (id && champions[id]) return id;
  const byName = Object.values(champions).find((c) => c.name === player.championName);
  return byName ? byName.id : null;
}

function getArchetype(champ) {
  if (!champ) return 'fighter';
  const [primary] = champ.tags;
  const { attack, magic } = champ.info;
  const apLeaning = magic > attack;
  switch (primary) {
    case 'Marksman': return 'marksman';
    case 'Mage': return 'mage';
    case 'Support': return apLeaning ? 'enchanter' : 'tank';
    case 'Tank': return 'tank';
    case 'Assassin': return apLeaning ? 'mage' : 'assassin';
    case 'Fighter': return apLeaning ? 'mage' : 'fighter';
    default: return apLeaning ? 'mage' : 'fighter';
  }
}

// Keystone rune ids (stable across patches; unknown ids are ignored).
const RUNE = {
  PRESS_THE_ATTACK: 8005, LETHAL_TEMPO: 8008, CONQUEROR: 8010, FLEET_FOOTWORK: 8021,
  ELECTROCUTE: 8112, DARK_HARVEST: 8128, HAIL_OF_BLADES: 9923,
  AERY: 8214, ARCANE_COMET: 8229, PHASE_RUSH: 8230,
  GLACIAL_AUGMENT: 8351, UNSEALED_SPELLBOOK: 8360, FIRST_STRIKE: 8369,
  GRASP: 8437, AFTERSHOCK: 8439, GUARDIAN: 8465,
};

// What an enemy keystone adds to the threat profile.
const ENEMY_KEYSTONE_THREATS = {
  [RUNE.CONQUEROR]: { healing: 1 },
  [RUNE.FLEET_FOOTWORK]: { healing: 0.5 },
  [RUNE.GRASP]: { healing: 0.5, tanks: 0.5 },
  [RUNE.AFTERSHOCK]: { tanks: 0.5, cc: 0.5 },
  [RUNE.GUARDIAN]: { tanks: 0.25 },
  [RUNE.ELECTROCUTE]: { burst: 1 },
  [RUNE.DARK_HARVEST]: { burst: 1 },
  [RUNE.HAIL_OF_BLADES]: { burst: 0.5 },
  [RUNE.FIRST_STRIKE]: { burst: 0.5 },
  [RUNE.ARCANE_COMET]: { burst: 0.5 },
  [RUNE.GLACIAL_AUGMENT]: { cc: 0.5 },
};

// Extra item tag weights from my own keystone.
const MY_KEYSTONE_WEIGHTS = {
  [RUNE.LETHAL_TEMPO]: { AttackSpeed: 1.5, OnHit: 0.5 },
  [RUNE.HAIL_OF_BLADES]: { Damage: 0.5, ArmorPenetration: 0.5 },
  [RUNE.PRESS_THE_ATTACK]: { AttackSpeed: 0.5, Damage: 0.5 },
  [RUNE.CONQUEROR]: { Health: 0.5, CooldownReduction: 0.5, LifeSteal: 0.5, SpellVamp: 0.5 },
  [RUNE.FLEET_FOOTWORK]: { LifeSteal: 0.5, AttackSpeed: 0.5 },
  [RUNE.ELECTROCUTE]: { ArmorPenetration: 1, MagicPenetration: 1 },
  [RUNE.DARK_HARVEST]: { ArmorPenetration: 1, MagicPenetration: 1 },
  [RUNE.FIRST_STRIKE]: { MagicPenetration: 0.5, ArmorPenetration: 0.5 },
  [RUNE.ARCANE_COMET]: { CooldownReduction: 1, Mana: 0.5 },
  [RUNE.AERY]: { CooldownReduction: 0.5, ManaRegen: 0.5 },
  [RUNE.PHASE_RUSH]: { CooldownReduction: 0.5, NonbootsMovement: 0.5 },
  [RUNE.GRASP]: { Health: 1, Armor: 0.5, SpellBlock: 0.5 },
  [RUNE.AFTERSHOCK]: { Health: 0.5, Armor: 0.5, SpellBlock: 0.5 },
  [RUNE.GUARDIAN]: { Health: 0.5, Aura: 0.5 },
};
const KEYSTONE_REASON_MIN = 1; // show "fits your keystone" when its bonus is at least this

const keystoneOf = (player) => player?.runes?.keystone || null;

function findMe(game) {
  const me = game.activePlayer;
  if (!me || !Array.isArray(game.allPlayers)) return null;
  return game.allPlayers.find(
    (p) => (me.riotId && p.riotId === me.riotId) || (me.summonerName && p.summonerName === me.summonerName)
  ) || null;
}

function analyzeEnemies(enemies, data) {
  let ad = 0, ap = 0, healing = 0, cc = 0, burst = 0, crit = 0, armor = 0, mr = 0, tanks = 0;

  for (const enemy of enemies) {
    const champ = data.champions[championIdFromPlayer(enemy, data.champions)];
    const kills = enemy.scores?.kills || 0;
    const deaths = enemy.scores?.deaths || 0;
    let weight = Math.max(0.5, 1 + kills * 0.2 - deaths * 0.05);

    if (champ) {
      if (champ.tags[0] === 'Tank') { weight *= 0.6; tanks += 1; cc += 0.5; }
      if (champ.tags.includes('Assassin')) burst += 1;
      if (HEALERS.has(champ.id)) healing += 1;
      if (HEAVY_CC.has(champ.id)) cc += 1;
      const total = champ.info.attack + champ.info.magic || 1;
      ad += (weight * champ.info.attack) / total;
      ap += (weight * champ.info.magic) / total;
    }

    const rune = ENEMY_KEYSTONE_THREATS[keystoneOf(enemy)?.id];
    if (rune) {
      healing += rune.healing || 0;
      burst += rune.burst || 0;
      cc += rune.cc || 0;
      tanks += rune.tanks || 0;
    }

    // Built items shift the damage profile and reveal defensive stats.
    let phys = 0, mag = 0;
    for (const owned of enemy.items || []) {
      const item = data.items[String(owned.itemID)];
      if (!item) continue;
      const s = item.stats || {};
      phys += s.FlatPhysicalDamageMod || 0;
      mag += s.FlatMagicDamageMod || 0;
      crit += s.FlatCritChanceMod || 0;
      armor += s.FlatArmorMod || 0;
      mr += s.FlatSpellBlockMod || 0;
      if (item.tags?.includes('LifeSteal') || item.tags?.includes('SpellVamp')) healing += 0.5;
    }
    if (phys + mag > 0) {
      ad += (weight * 0.5 * phys) / (phys + mag);
      ap += (weight * 0.5 * mag) / (phys + mag);
    }
  }

  const sum = ad + ap || 1;
  const adShare = ad / sum;
  const apShare = ap / sum;
  const flags = {
    healing: healing >= 1.5,
    burst: burst >= 2,
    cc: cc >= 3,
    crit: crit >= 0.5,
    highArmor: armor >= 180 || tanks >= 2,
    highMR: mr >= 150 || tanks >= 2,
    heavyAD: adShare >= 0.65,
    heavyAP: apShare >= 0.6,
  };
  return { adShare, apShare, flags };
}

function isBoots(item) {
  return item.tags?.includes('Boots');
}

// Completed legendary item (not boots): what build order slots count.
function isCoreItem(id, items, mapNumber = 11) {
  const item = items[String(id)];
  return Boolean(item) && !isBoots(item) && isCandidate(String(id), item, mapNumber);
}

function isCandidate(id, item, mapNumber) {
  if (Number(id) >= 10000) return false; // mode-specific duplicates (Arena, etc.)
  if (!item.maps?.[String(mapNumber)]) return false;
  if (!item.gold?.purchasable || item.consumed || item.hideFromAll || item.inStore === false) return false;
  if (item.requiredChampion || item.requiredAlly) return false;
  if (item.tags?.some((t) => ['Consumable', 'Trinket', 'Jungle', 'Lane', 'GoldPer'].includes(t))) return false;
  if (isBoots(item)) return Boolean(item.from?.includes('1001')); // tier-2 boots only
  return !(item.into && item.into.length) && item.gold.total >= 2000; // completed legendary items
}

function allComponents(id, items, acc = new Set()) {
  for (const part of items[id]?.from || []) {
    if (!acc.has(part)) {
      acc.add(part);
      allComponents(part, items, acc);
    }
  }
  return acc;
}

function counterReasons(id, archetype, flags) {
  const reasons = [];
  for (const rule of COUNTERS) {
    if (flags[rule.flag] && rule.ids[archetype]?.includes(id)) reasons.push({ key: `reason.counter.${rule.flag}` });
  }
  return reasons;
}

const META_MIN_ROLE_GAMES = 30;
const META_MIN_GAMES = 20;
const META_MIN_ITEM_GAMES = 10;
const META_FIT_PICK = 0.15; // items this popular fit regardless of archetype tags

// Champion stats for the player's role, falling back to all roles.
function metaBucket(meta, champId, position) {
  const champ = meta?.champions?.[champId];
  if (!champ) return null;
  const role = champ[position];
  if (role && role.games >= META_MIN_ROLE_GAMES) return role;
  return champ.ALL && champ.ALL.games >= META_MIN_GAMES ? champ.ALL : null;
}

function metaStat(bucket, id) {
  const stat = bucket?.items[id];
  if (!stat) return { pick: 0, winRate: null };
  return { pick: stat[0] / bucket.games, winRate: stat[0] >= META_MIN_ITEM_GAMES ? stat[1] / stat[0] : null };
}

function metaReason({ pick, winRate }) {
  const params = { pick: Math.round(pick * 100) };
  if (winRate === null) return { key: 'reason.metaPick', params };
  return { key: 'reason.meta', params: { ...params, wr: Math.round(winRate * 100) } };
}

const ORDER_WEIGHT = 10; // share of games this item is the next completed buy
const NEXT_ORDER_WEIGHT = 2; // ...or the one after (kept low so the current slot dominates)

// Share of games where `id` was bought as completed item number `slot`.
function orderShare(bucket, slot, id) {
  const slotStats = bucket?.order?.[slot];
  if (!slotStats) return 0;
  const total = Object.values(slotStats).reduce((s, [games]) => s + games, 0);
  return total ? (slotStats[id]?.[0] || 0) / total : 0;
}

function chooseBoots(archetype, threats, items, bucket, mapNumber) {
  const { flags } = threats;
  const options = [];
  if (flags.cc || flags.heavyAP) options.push([ITEM.MERCS, { key: flags.cc ? 'reason.bootsCC' : 'reason.counter.heavyAP' }]);
  if (flags.heavyAD || flags.crit) options.push([ITEM.STEELCAPS, { key: 'reason.counter.heavyAD' }]);

  // Most picked boots in the meta beat the archetype default.
  if (bucket) {
    const best = Object.keys(bucket.items)
      .filter((id) => items[id] && isBoots(items[id]) && isCandidate(id, items[id], mapNumber))
      .map((id) => [id, metaStat(bucket, id)])
      .sort((a, b) => b[1].pick - a[1].pick)[0];
    if (best && best[1].pick >= 0.1) options.push([best[0], metaReason(best[1])]);
  }

  const defaults = {
    mage: ITEM.SORCS, marksman: ITEM.BERSERKERS, assassin: ITEM.IONIAN,
    fighter: ITEM.IONIAN, enchanter: ITEM.IONIAN, tank: threats.adShare >= 0.5 ? ITEM.STEELCAPS : ITEM.MERCS,
  };
  options.push([defaults[archetype], { key: 'reason.bootsDefault' }]);

  for (const [id, reason] of options) {
    if (items[id]) return { id, reason };
  }
  return null;
}

/**
 * @param {object} game Live Client Data "allgamedata" payload
 * @param {{version:string, items:object, champions:object}} data Data Dragon data
 * @param {{count?:number, meta?:object|null}} [options] meta: aggregated stats from meta/store.js
 */
function recommend(game, data, { count = 3, meta = null } = {}) {
  const me = findMe(game);
  if (!me) return { error: 'status.notFound' };

  const mapNumber = game.gameData?.mapNumber || 11;
  const myChampId = championIdFromPlayer(me, data.champions);
  const archetype = getArchetype(data.champions[myChampId]);
  // Meta is collected from ranked Summoner's Rift only.
  const bucket = mapNumber === 11 ? metaBucket(meta, myChampId, me.position) : null;
  const enemies = game.allPlayers.filter((p) => p.team !== me.team);
  const threats = analyzeEnemies(enemies, data);

  const ownedIds = new Set((me.items || []).map((i) => String(i.itemID)));
  const ownsBoots = [...ownedIds].some((id) => data.items[id] && isBoots(data.items[id]));
  // Next completed-item slot (1-based), for build order stats.
  const slot = 1 + [...ownedIds].filter((id) => isCoreItem(id, data.items, mapNumber)).length;

  // Defensive stats scale with enemy damage profile for frontline archetypes.
  const weights = { ...TAG_WEIGHTS[archetype] };
  if (archetype === 'tank' || archetype === 'fighter') {
    weights.Armor = (weights.Armor || 0) + threats.adShare * 2;
    weights.SpellBlock = (weights.SpellBlock || 0) + threats.apShare * 2;
  }

  // My keystone nudges stats it scales with (only tags the archetype already values).
  const keystone = keystoneOf(me);
  const keystoneWeights = MY_KEYSTONE_WEIGHTS[keystone?.id] || {};

  const scored = [];
  for (const [id, item] of Object.entries(data.items)) {
    if (ownedIds.has(id) || isBoots(item) || !isCandidate(id, item, mapNumber)) continue;

    const tags = item.tags || [];
    const counters = counterReasons(id, archetype, threats.flags);
    const stat = metaStat(bucket, id);
    const fits = tags.some((t) => REQUIRED_TAGS[archetype].includes(t)) &&
      !tags.some((t) => OFF_TAGS[archetype].includes(t));
    if (!fits && !counters.length && stat.pick < META_FIT_PICK) continue;

    // With meta available, generic tag fit matters less than what players actually build.
    let score = tags.reduce((s, t) => s + (weights[t] || 0), 0) * (bucket ? 0.5 : 1);
    const keystoneBonus = fits ? tags.reduce((s, t) => s + (keystoneWeights[t] || 0), 0) : 0;
    score += keystoneBonus;
    score += counters.length * COUNTER_BONUS;
    const reasons = [...counters];
    if (keystoneBonus >= KEYSTONE_REASON_MIN && keystone.displayName) {
      reasons.push({ key: 'reason.keystone', params: { rune: keystone.displayName } });
    }

    if (bucket) {
      score += stat.pick * 12 + (stat.winRate !== null ? (stat.winRate - 0.5) * 20 : 0);
      const share = orderShare(bucket, slot, id);
      score += share * ORDER_WEIGHT + orderShare(bucket, slot + 1, id) * NEXT_ORDER_WEIGHT;
      if (share >= 0.1) reasons.push({ key: 'reason.order', params: { slot, pick: Math.round(share * 100) } });
      else if (stat.pick >= 0.1) reasons.push(metaReason(stat));
    }

    const owned = [...allComponents(id, data.items)].filter((c) => ownedIds.has(c));
    if (owned.length) {
      score += 1.5;
      reasons.push({ key: 'reason.buildsFrom', params: { item: data.items[owned[0]].name } });
    }
    if (!reasons.length) reasons.push({ key: 'reason.core', params: { archetype: { key: `archetype.${archetype}` } } });

    scored.push({ id, name: item.name, cost: item.gold.total, score, reasons });
  }

  scored.sort((a, b) => b.score - a.score || a.cost - b.cost);

  // Unique names only (Data Dragon sometimes lists variants).
  const seen = new Set();
  const picks = scored.filter((s) => !seen.has(s.name) && seen.add(s.name)).slice(0, count);

  let boots = null;
  if (!ownsBoots) {
    const choice = chooseBoots(archetype, threats, data.items, bucket, mapNumber);
    if (choice) {
      const item = data.items[choice.id];
      boots = { id: choice.id, name: item.name, cost: item.gold.total, reasons: [choice.reason] };
    }
  }

  return {
    me: { championId: myChampId, championName: data.champions[myChampId]?.name || me.championName, archetype, gold: Math.floor(game.activePlayer.currentGold || 0) },
    threats: {
      adShare: Math.round(threats.adShare * 100),
      apShare: Math.round(threats.apShare * 100),
      flags: Object.keys(threats.flags).filter((f) => threats.flags[f]),
    },
    boots,
    items: picks,
    metaGames: bucket ? bucket.games : 0,
  };
}

module.exports = { recommend, analyzeEnemies, getArchetype, championIdFromPlayer, isCandidate, isCoreItem, ITEM, RUNE };
