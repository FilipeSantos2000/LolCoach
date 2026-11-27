// Minimal Riot API client with client-side rate limiting.

const PLATFORM_REGION = {
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', sg2: 'sea', tw2: 'sea', vn2: 'sea',
};

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

class RiotAuthError extends Error {}

// Sliding-window limiter. Defaults match Riot personal/dev keys: 20 req/1s and 100 req/2min.
class RateLimiter {
  constructor({ limits = [[20, 1000], [100, 120000]], now = Date.now, sleep = defaultSleep } = {}) {
    this.limits = limits;
    this.now = now;
    this.sleep = sleep;
    this.stamps = [];
    this.maxWindow = Math.max(...limits.map(([, w]) => w));
  }

  async acquire() {
    for (;;) {
      const t = this.now();
      this.stamps = this.stamps.filter((s) => s > t - this.maxWindow);
      let wait = 0;
      for (const [count, windowMs] of this.limits) {
        const inWindow = this.stamps.filter((s) => s > t - windowMs);
        if (inWindow.length >= count) wait = Math.max(wait, inWindow[0] + windowMs - t);
      }
      if (wait <= 0) {
        this.stamps.push(t);
        return;
      }
      await this.sleep(wait + 10);
    }
  }
}

class RiotClient {
  constructor({ apiKey, platform = 'euw1', fetchImpl = fetch, limiter = new RateLimiter(), sleep = defaultSleep }) {
    if (!apiKey) throw new RiotAuthError('Missing RIOT_API_KEY');
    this.region = PLATFORM_REGION[platform];
    if (!this.region) throw new Error(`Unknown platform "${platform}"`);
    this.platform = platform;
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.limiter = limiter;
    this.sleep = sleep;
  }

  async get(host, path) {
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.limiter.acquire();
      const res = await this.fetch(`https://${host}.api.riotgames.com${path}`, {
        headers: { 'X-Riot-Token': this.apiKey },
      });
      if (res.ok) return res.json();
      if (res.status === 401 || res.status === 403) throw new RiotAuthError(`Riot API key rejected (${res.status})`);
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        await this.sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`Riot API ${res.status} for ${path}`);
    }
    throw new Error(`Riot API retries exhausted for ${path}`);
  }

  // PUUIDs of Challenger + Grandmaster solo queue players.
  async highEloPuuids() {
    const puuids = [];
    for (const tier of ['challenger', 'grandmaster']) {
      const league = await this.get(this.platform, `/lol/league/v4/${tier}leagues/by-queue/RANKED_SOLO_5x5`);
      for (const entry of league?.entries || []) if (entry.puuid) puuids.push(entry.puuid);
    }
    return puuids;
  }

  matchIds(puuid, { startTime, count = 20 } = {}) {
    let q = `queue=420&type=ranked&start=0&count=${count}`;
    if (startTime) q += `&startTime=${Math.floor(startTime / 1000)}`;
    return this.get(this.region, `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${q}`);
  }

  match(id) {
    return this.get(this.region, `/lol/match/v5/matches/${encodeURIComponent(id)}`);
  }

  matchTimeline(id) {
    return this.get(this.region, `/lol/match/v5/matches/${encodeURIComponent(id)}/timeline`);
  }
}

module.exports = { RiotClient, RateLimiter, RiotAuthError, PLATFORM_REGION };
