// Reads the Riot Live Client Data API, exposed locally by the game client during a match.
const https = require('https');

// The game serves a self-signed Riot certificate on localhost only.
// Verification is disabled for this agent, which is only ever used against 127.0.0.1.
const localAgent = new https.Agent({ rejectUnauthorized: false });

function getAllGameData(timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { host: '127.0.0.1', port: 2999, path: '/liveclientdata/allgamedata', agent: localAgent, timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Live client returned ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Live client timeout')));
    req.on('error', reject);
  });
}

module.exports = { getAllGameData };
