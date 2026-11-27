// Loads static game data (items, champions) from Riot Data Dragon, cached on disk per patch.
const fs = require('fs');
const path = require('path');

const BASE = 'https://ddragon.leagueoflegends.com';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function readLatestCache(cacheDir, locale) {
  if (!fs.existsSync(cacheDir)) return null;
  const files = fs.readdirSync(cacheDir).filter((f) => f.startsWith('ddragon-') && f.endsWith(`-${locale}.json`)).sort();
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(cacheDir, files[files.length - 1]), 'utf8'));
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
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

  const [items, champions] = await Promise.all([
    getJson(`${BASE}/cdn/${version}/data/${locale}/item.json`),
    getJson(`${BASE}/cdn/${version}/data/${locale}/champion.json`),
  ]);
  const data = { version, locale, items: items.data, champions: champions.data };

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(data));
  return data;
}

function itemImageUrl(version, id) {
  return `${BASE}/cdn/${version}/img/item/${id}.png`;
}

module.exports = { loadStaticData, itemImageUrl };
