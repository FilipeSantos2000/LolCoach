// Client for the local League Client (LCU) API, used during champion select.
// Credentials come from the client's lockfile, or from the LeagueClientUx process command line.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// The client serves a self-signed Riot certificate on localhost only.
const localAgent = new https.Agent({ rejectUnauthorized: false });
const DISCOVER_INTERVAL_MS = 10000;

// Lockfile format: name:pid:port:password:protocol
function parseLockfile(text) {
  const parts = String(text).trim().split(':');
  const port = Number(parts[2]);
  const password = parts[3];
  return port && password ? { port, password } : null;
}

function parseCommandLine(cmd) {
  const port = /--app-port=(\d+)/.exec(cmd || '')?.[1];
  const password = /--remoting-auth-token=([\w-]+)/.exec(cmd || '')?.[1];
  return port && password ? { port: Number(port), password } : null;
}

function lockfilePaths() {
  return [
    process.env.LEAGUE_PATH && path.join(process.env.LEAGUE_PATH, 'lockfile'),
    'C:\\Riot Games\\League of Legends\\lockfile',
  ].filter(Boolean);
}

function credentialsFromProcess() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine"],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => resolve(err ? null : parseCommandLine(stdout))
    );
  });
}

function request({ port, password }, pathname) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { host: '127.0.0.1', port, path: pathname, agent: localAgent, auth: `riot:${password}`, timeout: 2000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) return reject(new Error('LCU auth failed'));
          if (res.statusCode !== 200) return resolve(null); // e.g. 404 when not in champ select
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('LCU timeout')));
    req.on('error', reject);
  });
}

class LcuClient {
  constructor() {
    this.creds = null;
    this.lastDiscover = 0;
  }

  async discover() {
    for (const file of lockfilePaths()) {
      try {
        const creds = parseLockfile(fs.readFileSync(file, 'utf8'));
        if (creds) return creds;
      } catch {
        // Not there; try the next option.
      }
    }
    return credentialsFromProcess();
  }

  async get(pathname) {
    if (!this.creds) {
      if (Date.now() - this.lastDiscover < DISCOVER_INTERVAL_MS) return null;
      this.lastDiscover = Date.now();
      this.creds = await this.discover();
      if (!this.creds) return null;
    }
    try {
      return await request(this.creds, pathname);
    } catch {
      this.creds = null; // client closed or restarted: rediscover later
      return null;
    }
  }

  gameflowPhase() {
    return this.get('/lol-gameflow/v1/gameflow-phase');
  }

  champSelectSession() {
    return this.get('/lol-champ-select/v1/session');
  }

  // Champions you can pick right now (owned + free rotation, minus bans/picks).
  pickableChampionIds() {
    return this.get('/lol-champ-select/v1/pickable-champion-ids');
  }
}

module.exports = { LcuClient, parseLockfile, parseCommandLine };
