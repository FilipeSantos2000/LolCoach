// Auto-update from GitHub Releases (electron-updater). Only active in the installed app.
// Flow: check on start and every few hours -> download in background -> install on quit,
// or right away when the user clicks "restart to update". Never restarts on its own.

const FIRST_CHECK_MS = 10 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * @param {object} opts
 * @param {boolean} opts.enabled        false in development (no installed app to replace)
 * @param {() => object} opts.loadUpdater  returns electron-updater's autoUpdater (lazy, so dev never loads it)
 * @param {(state: object) => void} opts.onChange  called with { state, version?, percent? }
 */
function createUpdater({ enabled, loadUpdater, onChange = () => {}, timers = { setTimeout, setInterval, clearTimeout, clearInterval } }) {
  let current = { state: 'idle' };
  const set = (next) => {
    current = next;
    onChange(current);
  };

  if (!enabled) {
    return { get: () => current, check: async () => {}, install: () => false, stop: () => {} };
  }

  const updater = loadUpdater();
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  updater.on('checking-for-update', () => {
    if (current.state !== 'ready') set({ state: 'checking' });
  });
  updater.on('update-not-available', () => {
    if (current.state !== 'ready') set({ state: 'idle' });
  });
  updater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }));
  updater.on('download-progress', (p) => {
    set({ state: 'downloading', version: current.version, percent: Math.round(p.percent || 0) });
  });
  updater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
  updater.on('error', (err) => {
    console.error('Update error:', err?.message || err);
    // Keep a finished download installable; otherwise go quiet and retry on the next check.
    if (current.state !== 'ready') set({ state: 'idle' });
  });

  const check = async () => {
    if (current.state === 'ready' || current.state === 'downloading') return;
    try {
      await updater.checkForUpdates();
    } catch (err) {
      console.error('Update check failed:', err?.message || err);
    }
  };

  const first = timers.setTimeout(check, FIRST_CHECK_MS);
  const every = timers.setInterval(check, CHECK_EVERY_MS);

  return {
    get: () => current,
    check,
    // Returns true when an install was started.
    install: () => {
      if (current.state !== 'ready') return false;
      updater.quitAndInstall(false, true); // not silent, relaunch after install
      return true;
    },
    stop: () => {
      timers.clearTimeout(first);
      timers.clearInterval(every);
    },
  };
}

module.exports = { createUpdater, FIRST_CHECK_MS, CHECK_EVERY_MS };
