// Per-patch meta stats stored as local JSON files: meta-<major.minor>.json

const fs = require('fs');
const path = require('path');

const ROLES = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);

// "16.23.1" or "16.23.712.1234" -> "16.23"
function patchOf(version) {
  return String(version).split('.').slice(0, 2).join('.');
}

function comparePatch(a, b) {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
}

// Bump when the stored shape changes; older files are recollected.
const SCHEMA = 3;
const ORDER_SLOTS = 3; // track the first 3 completed items

function emptyMeta(patch) {
  return { schema: SCHEMA, patch, matches: 0, champions: {}, seen: [], players: null, cursor: 0, floor: 0, updatedAt: null };
}

function metaFile(dir, patch) {
  return path.join(dir, `meta-${patch}.json`);
}

function loadMeta(dir, patch) {
  const file = metaFile(dir, patch);
  if (!fs.existsSync(file)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    return meta.schema === SCHEMA ? meta : null; // old format: start over
  } catch {
    return null; // corrupt file: start over
  }
}

function saveMeta(dir, meta) {
  fs.mkdirSync(dir, { recursive: true });
  meta.updatedAt = new Date().toISOString();
  const file = metaFile(dir, meta.patch);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta));
  fs.renameSync(tmp, file); // atomic replace
}

function listPatches(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((f) => /^meta-(\d+\.\d+)\.json$/.exec(f)?.[1])
    .filter(Boolean)
    .sort(comparePatch);
}

/**
 * Picks the meta to use: current patch if it has enough matches,
 * otherwise the newest older patch that does.
 */
function selectMeta(dir, currentPatch, minMatches = 200) {
  const current = loadMeta(dir, currentPatch);
  if (current && current.matches >= minMatches) return { meta: current, stale: false };

  const older = listPatches(dir).filter((p) => comparePatch(p, currentPatch) < 0).reverse();
  for (const patch of older) {
    const meta = loadMeta(dir, patch);
    if (meta && meta.matches >= minMatches) return { meta, stale: true };
  }
  return { meta: null, stale: false };
}

function bump(map, key, win) {
  const stat = (map[key] ??= [0, 0]);
  stat[0] += 1;
  if (win) stat[1] += 1;
}

/**
 * First completed items each participant bought, in order, from a Match-V5 timeline.
 * Undone purchases are removed; re-buys of the same item count once.
 * @returns {Map<number, number[]>} participantId -> item ids
 */
function buildOrders(timeline, isCoreItem) {
  const bought = new Map();
  const events = (timeline?.info?.frames || []).flatMap((f) => f.events || []);
  for (const e of events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))) {
    const list = bought.get(e.participantId) || [];
    if (e.type === 'ITEM_PURCHASED') {
      list.push(e.itemId);
    } else if (e.type === 'ITEM_UNDO') {
      const i = list.lastIndexOf(e.beforeId);
      if (i >= 0) list.splice(i, 1);
    }
    bought.set(e.participantId, list);
  }

  const orders = new Map();
  for (const [pid, list] of bought) {
    const core = [...new Set(list.filter(isCoreItem))].slice(0, ORDER_SLOTS);
    if (core.length) orders.set(pid, core);
  }
  return orders;
}

/**
 * Adds one Match-V5 match to the aggregate. All stats are [games, wins].
 * Role buckets also track lane matchups (vs) and teammates (with).
 * With build orders, buckets track order[slot][itemId] for slots 1..3.
 */
function addMatch(meta, match, champIdOf, orders = null) {
  const players = match.info.participants.map((p) => ({ ...p, champId: champIdOf(p.championName) }));

  for (const p of players) {
    if (!p.champId) continue;
    const role = ROLES.has(p.teamPosition) ? p.teamPosition : null;
    const items = new Set(
      [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((i) => i > 0).map(String)
    );

    const champ = (meta.champions[p.champId] ??= {});
    for (const key of role ? [role, 'ALL'] : ['ALL']) {
      const bucket = (champ[key] ??= { games: 0, wins: 0, items: {} });
      bucket.games += 1;
      if (p.win) bucket.wins += 1;
      for (const id of items) bump(bucket.items, id, p.win);

      const order = orders?.get(p.participantId);
      if (order) {
        bucket.order ??= {};
        order.forEach((itemId, i) => bump((bucket.order[i + 1] ??= {}), String(itemId), p.win));
      }
    }

    if (role) {
      const bucket = champ[role];
      bucket.vs ??= {};
      bucket.with ??= {};
      const opponent = players.find((q) => q.teamId !== p.teamId && q.teamPosition === role && q.champId);
      if (opponent) bump(bucket.vs, opponent.champId, p.win);
      for (const ally of players) {
        if (ally !== p && ally.teamId === p.teamId && ally.champId) bump(bucket.with, ally.champId, p.win);
      }
    }
  }
  meta.matches += 1;
}

module.exports = { patchOf, comparePatch, emptyMeta, loadMeta, saveMeta, selectMeta, addMatch, buildOrders, listPatches };
