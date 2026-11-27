// Collects high-elo matches for one patch. Resumable: progress is saved to the meta file.

const { patchOf, comparePatch, emptyMeta, loadMeta, saveMeta, addMatch, buildOrders } = require('./store');

const SEARCH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const SAVE_EVERY = 25;

/**
 * @param {object} opts
 * @param {import('./riot').RiotClient} opts.client
 * @param {string} opts.dir         Folder for meta files
 * @param {string} opts.patch       Patch to collect, e.g. "16.23"
 * @param {(name:string)=>string|null} opts.champIdOf  Match-V5 championName -> Data Dragon id
 * @param {number} [opts.target]    Stop after this many matches
 * @param {(meta:object)=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {(itemId:number)=>boolean} [opts.isCoreItem]  When set, timelines are fetched to learn build order
 */
async function collect({ client, dir, patch, champIdOf, target = 2000, onProgress = () => {}, signal, now = Date.now, isCoreItem = null }) {
  const meta = loadMeta(dir, patch) || emptyMeta(patch);
  const aborted = () => signal?.aborted;
  if (meta.matches >= target) return meta;

  if (!meta.players) {
    meta.players = await client.highEloPuuids();
    meta.cursor = 0;
  }
  // Only look at recent games; raised as soon as an older-patch game is seen.
  if (!meta.floor) meta.floor = now() - SEARCH_WINDOW_MS;
  saveMeta(dir, meta);

  const seen = new Set(meta.seen);
  let sinceSave = 0;

  while (meta.cursor < meta.players.length && meta.matches < target && !aborted()) {
    const ids = (await client.matchIds(meta.players[meta.cursor], { startTime: meta.floor })) || [];

    for (const id of ids) {
      if (aborted() || meta.matches >= target) break;
      if (seen.has(id)) continue;

      const match = await client.match(id);
      seen.add(id);
      meta.seen.push(id);
      if (!match?.info) continue;

      const matchPatch = patchOf(match.info.gameVersion);
      if (matchPatch === patch) {
        // Timeline costs one extra request per match; it is optional.
        const timeline = isCoreItem && client.matchTimeline ? await client.matchTimeline(id) : null;
        addMatch(meta, match, champIdOf, timeline ? buildOrders(timeline, isCoreItem) : null);
        onProgress(meta);
      } else if (comparePatch(matchPatch, patch) < 0) {
        // IDs are newest first: the rest of this list is older too.
        meta.floor = Math.max(meta.floor, match.info.gameCreation + 1);
        break;
      }

      if (++sinceSave >= SAVE_EVERY) {
        saveMeta(dir, meta);
        sinceSave = 0;
      }
    }
    if (!aborted()) meta.cursor += 1;
  }

  saveMeta(dir, meta);
  onProgress(meta);
  return meta;
}

module.exports = { collect };
