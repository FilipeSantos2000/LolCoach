// Electron main process: overlay window, polling loop and background meta collection.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage } = require('electron');
const { t } = require('./renderer/i18n');
const { MIN_SIZE, restoreBounds, resizeFrom } = require('./bounds');
const { loadStaticData, itemImageUrl } = require('./ddragon');
const { getAllGameData } = require('./live');
const { recommend, isCoreItem } = require('./engine');
const { RiotClient, RiotAuthError } = require('./meta/riot');
const { patchOf, selectMeta } = require('./meta/store');
const { collect } = require('./meta/collector');
const { LcuClient } = require('./lcu');
const { suggestChampions } = require('./draft');

// Optional .env (RIOT_API_KEY, RIOT_PLATFORM, META_TARGET_MATCHES, LEAGUE_PATH).
// Installed app: %APPDATA%\lolcoach\.env. Development: next to package.json.
// Values already set are not overwritten, so the first file found wins per key.
for (const envFile of [path.join(app.getPath('userData'), '.env'), path.join(__dirname, '..', '.env')]) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // Missing file: fine, app runs rules-only without a key.
  }
}

// Only one overlay at a time.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) app.quit();

const POLL_MS = 5000;
const DRAFT_POLL_MS = 2000;
const DEMO = process.argv.includes('--demo');
const DEMO_DRAFT = process.argv.includes('--demo-draft');
const DEMO_FILE = path.join(__dirname, '..', 'sample', 'allgamedata.json');
const DEMO_DRAFT_FILE = path.join(__dirname, '..', 'sample', 'champselect.json');
const META_MIN_MATCHES = 200;

// UI language -> Data Dragon locale (Riot has no pt-PT).
const LOCALES = { en: 'en_US', 'pt-BR': 'pt_BR' };

const lcu = new LcuClient();

let win = null;
let tray = null;
let staticData = null;
let pollTimer = null;
let metaDir = null;
let settingsFile = null;
let lang = 'en';
let savedBounds = null;
let metaStarted = false;
let currentMeta = { meta: null, stale: false };
let metaStatus = { key: 'meta.off' }; // translation key + params, rendered by the overlay
const metaAbort = new AbortController();

// settings.json: { lang, bounds }
function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {};
  } catch {
    // First run or unreadable file: use defaults.
  }
  if (!LOCALES[saved.lang]) saved.lang = app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
  return saved;
}

function saveSettings() {
  const bounds = win && !win.isDestroyed() ? win.getBounds() : savedBounds;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ lang, bounds }));
}

// Save position/size shortly after the user stops moving or resizing.
let saveBoundsTimer = null;
function scheduleSaveBounds() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveSettings, 500);
}

function createWindow() {
  const workAreas = screen.getAllDisplays().map((d) => d.workArea);
  const bounds = restoreBounds(savedBounds, workAreas, screen.getPrimaryDisplay().workArea);
  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    frame: false,
    transparent: true,
    // Transparent windows can't be resized from the edge on Windows; the overlay has its own corner handle.
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Stay above borderless-windowed games.
  win.setAlwaysOnTop(true, 'screen-saver');

  // The overlay never navigates or opens windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('move', scheduleSaveBounds);
  win.on('resize', scheduleSaveBounds);
  win.on('close', () => {
    clearTimeout(saveBoundsTimer);
    saveSettings();
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Corner handle: the renderer reports pointer deltas from where the drag started.
let resizeStart = null;
ipcMain.on('resize-start', () => {
  if (win) resizeStart = win.getBounds();
});
ipcMain.on('resize-move', (_event, dx, dy) => {
  if (!win || !resizeStart || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  win.setBounds(resizeFrom(resizeStart, dx, dy));
});
ipcMain.on('resize-end', () => {
  resizeStart = null;
  scheduleSaveBounds();
});
// Keyboard resizing: one step at a time.
ipcMain.on('resize-by', (_event, dx, dy) => {
  if (!win || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  win.setBounds(resizeFrom(win.getBounds(), dx, dy));
  scheduleSaveBounds();
});

function toggleOverlay() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.showInactive();
}

// Tray icon: the overlay has no taskbar entry, so this is how to reach it once hidden.
function buildTrayMenu() {
  if (!tray) return;
  const items = [
    { label: t(lang, 'tray.toggle'), click: toggleOverlay },
    { type: 'separator' },
  ];
  // Login items only make sense for the installed app (dev would register electron.exe).
  if (app.isPackaged) {
    items.push({
      label: t(lang, 'tray.autostart'),
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => app.setLoginItemSettings({ openAtLogin: menuItem.checked }),
    }, { type: 'separator' });
  }
  items.push({ label: t(lang, 'tray.quit'), click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('LoLCoach');
  tray.on('click', toggleOverlay);
  buildTrayMenu();
}

function send(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('update', { lang, ...payload });
}

function sendStatus(key, params) {
  send({ status: { key, params }, meta: metaLabel() });
}

function refreshSelectedMeta(patch) {
  currentMeta = selectMeta(metaDir, patch, META_MIN_MATCHES);
}

// Starts (or resumes) collection for the current patch in the background. Runs once per launch.
function startMetaCollection() {
  if (metaStarted) return;
  metaStarted = true;

  const patch = patchOf(staticData.version);
  refreshSelectedMeta(patch);

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) return;

  // Champion ids are locale-independent, so any loaded locale works here.
  const byLower = new Map(Object.keys(staticData.champions).map((id) => [id.toLowerCase(), id]));
  const champIdOf = (name) => byLower.get(String(name).toLowerCase()) || null;
  const target = Number(process.env.META_TARGET_MATCHES) || 5000;

  let client;
  try {
    client = new RiotClient({ apiKey, platform: process.env.RIOT_PLATFORM || 'euw1' });
  } catch (err) {
    metaStatus = { key: 'meta.configError', params: { message: err.message } };
    return;
  }

  let lastRefresh = 0;
  metaStatus = { key: 'meta.starting', params: { patch } };
  collect({
    client,
    dir: metaDir,
    patch,
    champIdOf,
    target,
    signal: metaAbort.signal,
    // Item ids are locale-independent; read staticData lazily since it is swapped on language change.
    isCoreItem: (itemId) => isCoreItem(itemId, staticData.items),
    onProgress: (meta) => {
      metaStatus = { key: 'meta.progress', params: { patch, matches: meta.matches, target } };
      // Re-select from disk now and then, so new data is used without a restart.
      if (meta.matches - lastRefresh >= 50) {
        lastRefresh = meta.matches;
        refreshSelectedMeta(patch);
      }
    },
  })
    .then((meta) => {
      metaStatus = { key: 'meta.done', params: { patch, matches: meta.matches } };
      refreshSelectedMeta(patch);
    })
    .catch((err) => {
      metaStatus = err instanceof RiotAuthError
        ? { key: 'meta.badKey' }
        : { key: 'meta.error', params: { message: err.message } };
      console.error(err);
    });
}

function metaLabel() {
  const { meta, stale } = currentMeta;
  return { ...metaStatus, stalePatch: meta && stale ? meta.patch : null };
}

async function readGame() {
  if (DEMO) return JSON.parse(fs.readFileSync(DEMO_FILE, 'utf8'));
  return getAllGameData();
}

// Returns true when champion select was handled.
async function draftTick() {
  let session;
  let pickable = null;
  if (DEMO_DRAFT) {
    session = JSON.parse(fs.readFileSync(DEMO_DRAFT_FILE, 'utf8'));
  } else {
    if ((await lcu.gameflowPhase()) !== 'ChampSelect') return false;
    session = await lcu.champSelectSession();
    if (!session) return false;
    pickable = await lcu.pickableChampionIds();
  }

  const result = suggestChampions({ session, data: staticData, meta: currentMeta.meta, pickableIds: pickable });
  if (result.error) {
    sendStatus(result.error);
    return true;
  }
  const imageBase = `https://ddragon.leagueoflegends.com/cdn/${staticData.version}/img/champion/`;
  send({
    mode: 'draft',
    ...result,
    picks: result.picks.map((p) => ({ ...p, image: p.image && imageBase + p.image })),
    patch: staticData.version,
    meta: metaLabel(),
    demo: DEMO_DRAFT,
  });
  return true;
}

async function tick() {
  let delay = POLL_MS;
  try {
    if (!staticData || staticData.locale !== LOCALES[lang]) {
      if (!staticData) sendStatus('status.loadingData');
      staticData = await loadStaticData(path.join(app.getPath('userData'), 'cache'), LOCALES[lang]);
      startMetaCollection();
    }

    if (!DEMO && (await draftTick())) {
      delay = DRAFT_POLL_MS;
      return;
    }

    let game;
    try {
      game = await readGame();
    } catch {
      sendStatus('status.waiting');
      return;
    }
    if (!game?.allPlayers?.length) {
      sendStatus('status.loadingScreen');
      return;
    }

    const result = recommend(game, staticData, { meta: currentMeta.meta });
    if (result.error) {
      sendStatus(result.error);
      return;
    }

    const withImage = (it) => it && { ...it, image: itemImageUrl(staticData.version, it.id) };
    send({
      ...result,
      boots: withImage(result.boots),
      items: result.items.map(withImage),
      patch: staticData.version,
      meta: metaLabel(),
      demo: DEMO,
    });
  } catch (err) {
    sendStatus('status.error', { message: err.message });
  } finally {
    pollTimer = setTimeout(tick, delay);
  }
}

app.whenReady().then(() => {
  if (!gotInstanceLock) return;
  metaDir = path.join(app.getPath('userData'), 'meta');
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  const settings = loadSettings();
  lang = settings.lang;
  savedBounds = settings.bounds || null;

  createWindow();
  createTray();
  win.webContents.once('did-finish-load', tick);

  // Ctrl+Shift+L toggles the overlay.
  globalShortcut.register('CommandOrControl+Shift+L', toggleOverlay);
});

// A second launch (e.g. from the Start menu) just shows the running overlay.
app.on('second-instance', () => win?.showInactive());

ipcMain.on('close', () => app.quit());

// The overlay switches its own texts at once; champion/item names follow on the next tick.
ipcMain.on('set-language', (_event, next) => {
  if (!LOCALES[next] || next === lang) return;
  lang = next;
  saveSettings();
  buildTrayMenu();
});

app.on('will-quit', () => {
  clearTimeout(pollTimer);
  metaAbort.abort(); // collector saves progress and resumes next launch
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => app.quit());
