// Loads static game data (items, champions, runes) from Riot Data Dragon, cached on disk per patch.
const fs = require('fs');
const path = require('path');

const BASE = 'https://ddragon.leagueoflegends.com';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function readCache(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.runes ? data : null; // older cache without runes: refetch
  } catch {
    return null;
  }
}

// Most recently written cache for this locale (file names don't sort by patch: "16.9" > "16.23").
function readLatestCache(cacheDir, locale) {
  if (!fs.existsSync(cacheDir)) return null;
  const files = fs.readdirSync(cacheDir)
    .filter((f) => f.startsWith('ddragon-') && f.endsWith(`-${locale}.json`))
    .map((f) => path.join(cacheDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const file of files) {
    const data = readCache(file);
    if (data) return data;
  }
  return null;
}

// runesReforged.json is a tree of paths/slots/runes; flatten to id -> name.
function flattenRunes(trees) {
  const runes = {};
  for (const tree of trees || []) {
    for (const slot of tree.slots || []) {
      for (const rune of slot.runes || []) runes[rune.id] = rune.name;
    }
  }
  return runes;
}

async function loadStaticData(cacheDir, locale = 'en_US') {
  let version;
  try {
    version = (await getJson(`${BASE}/api/versions.json`))[0];
  } catch (err) {
    // Offline: fall back to the last cached patch.
    const cached = readLatestCache(cacheDir, locale);
    if (cached) return cached;
    throw err;
  }

  const cacheFile = path.join(cacheDir, `ddragon-${version}-${locale}.json`);
  const cached = fs.existsSync(cacheFile) && readCache(cacheFile);
  if (cached) return cached;

  const [items, champions, runes] = await Promise.all([
    getJson(`${BASE}/cdn/${version}/data/${locale}/item.json`),
    getJson(`${BASE}/cdn/${version}/data/${locale}/champion.json`),
    getJson(`${BASE}/cdn/${version}/data/${locale}/runesReforged.json`),
  ]);
  const data = { version, locale, items: items.data, champions: champions.data, runes: flattenRunes(runes) };

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(data));
  return data;
}

function itemImageUrl(version, id) {
  return `${BASE}/cdn/${version}/img/item/${id}.png`;
}

module.exports = { loadStaticData, itemImageUrl, flattenRunes };
