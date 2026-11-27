// Champion select suggestions: role win rate + lane matchup + ally synergy + team composition.

const POSITIONS = { top: 'TOP', jungle: 'JUNGLE', middle: 'MIDDLE', bottom: 'BOTTOM', utility: 'UTILITY' };

// Used only without meta, to keep suggestions role-appropriate.
const ROLE_TAGS = {
  TOP: ['Fighter', 'Tank'],
  JUNGLE: ['Fighter', 'Assassin', 'Tank'],
  MIDDLE: ['Mage', 'Assassin'],
  BOTTOM: ['Marksman'],
  UTILITY: ['Support'],
};

const K_BASE = 50; // prior games pulling role win rate to 50%
const K_PAIR = 20; // prior games pulling matchup/synergy to the champion's base
const MIN_ROLE_GAMES = 20;
const SYNERGY_WEIGHT = 0.5;
const SHOW_DELTA = 0.5; // percentage points

// Reasons are translation keys with params (see renderer/i18n.js).
const smooth = (wins, games, prior, k) => (wins + prior * k) / (games + k);
const apLeaning = (c) => c.info.magic > c.info.attack;

function compBonus(champ, allyChamps) {
  if (allyChamps.length < 2) return [];
  const adShare = allyChamps.reduce((s, c) => s + c.info.attack / (c.info.attack + c.info.magic || 1), 0) / allyChamps.length;
  const out = [];
  if (adShare >= 0.65 && apLeaning(champ)) out.push([1.5, { key: 'draft.addsAP' }]);
  if (adShare <= 0.35 && !apLeaning(champ)) out.push([1.5, { key: 'draft.addsAD' }]);
  if (!allyChamps.some((c) => c.tags.includes('Tank')) && champ.tags[0] === 'Tank') out.push([1, { key: 'draft.frontline' }]);
  return out;
}

// Probability that an enemy champion plays a given role, from meta play counts.
function roleProbability(meta, champId, role) {
  const champ = meta?.champions?.[champId];
  if (!champ?.ALL?.games) return 0;
  return (champ[role]?.games || 0) / champ.ALL.games;
}

/**
 * @param {object} opts
 * @param {object} opts.session     LCU /lol-champ-select/v1/session
 * @param {object} opts.data        Data Dragon data
 * @param {object|null} opts.meta   Aggregated meta (store.js)
 * @param {number[]|null} opts.pickableIds  LCU pickable champion keys
 */
function suggestChampions({ session, data, meta = null, pickableIds = null, count = 5 }) {
  const byKey = new Map(Object.values(data.champions).map((c) => [Number(c.key), c.id]));
  const me = session?.myTeam?.find((c) => c.cellId === session.localPlayerCellId);
  if (!me) return { error: 'status.notInChampSelect' };

  const role = POSITIONS[String(me.assignedPosition || '').toLowerCase()] || null;
  const allyIds = session.myTeam
    .filter((c) => c.cellId !== me.cellId)
    .map((c) => byKey.get(c.championId || c.championPickIntent))
    .filter(Boolean);
  const enemyIds = (session.theirTeam || []).map((c) => byKey.get(c.championId)).filter(Boolean);
  const taken = new Set([...allyIds, ...enemyIds]);
  const allyChamps = allyIds.map((id) => data.champions[id]);

  const pool = (pickableIds?.length ? pickableIds.map((k) => byKey.get(k)) : Object.keys(data.champions))
    .filter((id) => id && !taken.has(id));

  // Lane opponent is hidden, so weight each enemy by how often it plays my role.
  let laneWeights = role ? enemyIds.map((id) => [id, roleProbability(meta, id, role)]) : [];
  const totalWeight = laneWeights.reduce((s, [, p]) => s + p, 0);
  if (totalWeight > 1) laneWeights = laneWeights.map(([id, p]) => [id, p / totalWeight]);

  const picks = [];
  for (const id of pool) {
    const champ = data.champions[id];
    const bucket = role ? meta?.champions?.[id]?.[role] : meta?.champions?.[id]?.ALL;
    const reasons = [];
    let score = 0;

    if (meta) {
      if (!bucket || bucket.games < MIN_ROLE_GAMES) continue; // not played in this role
      const base = smooth(bucket.wins, bucket.games, 0.5, K_BASE);
      score = (base - 0.5) * 100;
      reasons.push({
        key: 'draft.base',
        params: { wr: { num: base * 100 }, role: { key: `roleIn.${role || 'ALL'}` }, games: bucket.games },
      });

      const deltas = [];
      for (const [enemy, p] of laneWeights) {
        const stat = bucket.vs?.[enemy];
        if (!stat || p <= 0) continue;
        const d = (smooth(stat[1], stat[0], base, K_PAIR) - base) * 100 * p;
        score += d;
        deltas.push([d, 'draft.vs', data.champions[enemy].name]);
      }
      for (const ally of allyIds) {
        const stat = bucket.with?.[ally];
        if (!stat) continue;
        const d = (smooth(stat[1], stat[0], base, K_PAIR) - base) * 100 * SYNERGY_WEIGHT;
        score += d;
        deltas.push([d, 'draft.with', data.champions[ally].name]);
      }
      deltas.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
      for (const [d, key, name] of deltas.slice(0, 2)) {
        if (Math.abs(d) >= SHOW_DELTA) reasons.push({ key, params: { delta: { num: d, sign: true }, name } });
      }
    } else if (role && !ROLE_TAGS[role].some((t) => champ.tags.includes(t))) {
      continue;
    }

    for (const [bonus, reason] of compBonus(champ, allyChamps)) {
      score += bonus;
      reasons.push(reason);
    }
    if (!meta && !reasons.length) reasons.push({ key: 'draft.fitsRole' });

    picks.push({ id, name: champ.name, image: champ.image?.full, score, reasons });
  }

  picks.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    role,
    allies: allyIds.map((id) => data.champions[id].name),
    enemies: enemyIds.map((id) => data.champions[id].name),
    hasMeta: Boolean(meta),
    picks: picks.slice(0, count),
  };
}

module.exports = { suggestChampions, roleProbability };
