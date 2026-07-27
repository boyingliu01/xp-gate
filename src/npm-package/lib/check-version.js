const https = require('https');
const fs = require('fs');
const path = require('path');

const DEFAULT_PKG_NAME = '@boyingliu01/xp-gate';
const REGISTRY_URL = (pkg) => `https://registry.npmjs.org/-/package/${encodeURIComponent(pkg)}/dist-tags`;
const NETWORK_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 300000; // 5 minutes

/**
 * Resolve the xp-gate data directory.
 *
 * Priority:
 *   1. XP_GATE_CACHE_DIR env var (used by tests to inject a temp dir)
 *   2. os.homedir() + '/.xp-gate' (standard location on all platforms)
 *
 * os.homedir() works correctly on Linux ($HOME), macOS ($HOME), and
 * Windows ($USERPROFILE), so no per-OS branching is needed.
 */
function xpGateDir() {
  if (process.env.XP_GATE_CACHE_DIR) {
    return process.env.XP_GATE_CACHE_DIR;
  }
  try {
    const home = require('os').homedir();
    return path.join(home, '.xp-gate');
  } catch { return null; }
}

/**
 * Read the package name from the installed package.json, falling back to DEFAULT_PKG_NAME.
 */
function getPackageName() {
  try {
    const pkgDir = path.dirname(__dirname);
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const name = pkg.name;
    // scoped name like @boyingliu01/xp-gate
    if (name && name.startsWith('@')) return name;
  } catch { /* fallthrough */ }
  return DEFAULT_PKG_NAME;
}

/**
 * Read the local version from the installed package.json.
 * @returns {string|null}
 */
function getLocalVersion() {
  try {
    const pkgDir = path.dirname(__dirname);
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Cache entry helpers — atomic file write via temp+rename to prevent concurrent read corruption.
 */
function cachePath() {
  const dir = xpGateDir();
  if (!dir) return null;
  return path.join(dir, 'version-cache.json');
}

function ensureDir(dir) {
  if (!dir) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch { return false; }
}

function readCache() {
  const cp = cachePath();
  if (!cp || !fs.existsSync(cp)) return null;
  try {
    const raw = fs.readFileSync(cp, 'utf8');
    const data = JSON.parse(raw);
    if (data && data.ts && data.version && (Date.now() - data.ts) < CACHE_TTL_MS) {
      return data;
    }
    // expired
    return null;
  } catch {
    return null;
  }
}

function writeCache(latest, publishedAt) {
  // Validate version before writing — prevent corrupted/non-semver values
  // from persisting in version-cache.json (e.g. undefined, empty string, placeholders).
  // Uses 3-digit semver: MAJOR.MINOR.PATCH with optional pre-release tag.
  const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
  if (typeof latest !== 'string' || !semverRegex.test(latest)) {
    console.warn(`[version-cache] Invalid version "${latest}" — not writing to cache`);
    return;
  }

  const cp = cachePath();
  if (!cp) return;
  ensureDir(path.dirname(cp));
  const data = JSON.stringify({ ts: Date.now(), version: latest, publishedAt });
  // atomic write: temp → rename
  const tmp = cp + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, cp);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* skip */ }
  }
}

function clearCache() {
  const cp = cachePath();
  if (cp && fs.existsSync(cp)) {
    try { fs.unlinkSync(cp); } catch { /* skip */ }
  }
}

/**
 * Fetch the published timestamp for a specific version from the npm registry.
 * Uses the dist-tag endpoint's "time" map to get the exact publish time.
 * This is called as a fire-and-forget background request to enrich cache.
 * @param {string} name — package name
 * @param {string} version — version to look up (e.g. "0.8.13")
 * @returns {Promise<string|null>} ISO timestamp string or null
 */
function getVersionTime(name, version) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: NETWORK_TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const data = JSON.parse(body);
          const time = data && data.time && data.time[version];
          resolve(typeof time === 'string' ? time : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Calculate lagDays between a publish timestamp and now.
 * Returns 0 if publishedAt is empty or unparseable.
 * @param {string} publishedAt — ISO timestamp string
 * @returns {number}
 */
function calcLagDays(publishedAt) {
  if (!publishedAt) return 0;
  const published = new Date(publishedAt).getTime();
  if (isNaN(published)) return 0;
  return Math.floor((Date.now() - published) / 86400000);
}

/**
 * Query npm registry for the latest version + publishedAt timestamp.
 * @param {string} [pkgName] — defaults to dynamic package name
 * @returns {{ latest: string, publishedAt: string }|null}
 */
function getRemoteVersion(pkgName) {
  // check cache first
  const cached = readCache();
  if (cached) return { latest: cached.version, publishedAt: cached.publishedAt || '' };

  const name = pkgName || getPackageName();
  const url = REGISTRY_URL(name);

  return new Promise((resolve) => {
    const req = https.get(url, { timeout: NETWORK_TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          // non-200 → return null (non-blocking)
          return resolve(null);
        }
        try {
          const data = JSON.parse(body);
          const latest = data && data.latest;
          if (typeof latest !== 'string') {
            // missing or non-string latest key
            return resolve(null);
          }
          // Extract publishedAt from the version's time entry.
          // We need to make a second request to get the time info.
          // This is done via getVersionTime() which is an async helper.
          // We resolve({latest, ''}) first and update the cache later
          // with the publishedAt from getVersionTime().
          let publishedAt = '';
          writeCache(latest, publishedAt);
          resolve({ latest, publishedAt });
          // Fire-and-forget: fetch publishedAt asynchronously to update cache
          getVersionTime(name, latest).then(time => {
            if (time) {
              writeCache(latest, time);
            }
          }).catch(() => {});
        } catch {
          // JSON parse failure
          resolve(null);
        }
      });
    });

    req.on('error', () => {
      // network error
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Compare local version against remote. Returns upgrade status.
 * @param {string} [pkgName]
 * @returns {Promise<{ outdated: boolean, local: string|null, remote: string|null, lagDays: number }>}
 */
async function checkUpgrade(pkgName) {
  const local = getLocalVersion();
  const remoteResult = await getRemoteVersion(pkgName);
  const remote = remoteResult ? remoteResult.latest : null;

  if (!local || !remote) {
    return { outdated: false, local, remote, lagDays: 0 };
  }

  const outdated = compareVersions(local, remote) < 0;

  // If the cached remoteResult didn't have publishedAt yet
  // (first call — fire-and-forget still in flight), fetch it now
  // and update the cache for next time.
  const name = pkgName || getPackageName();
  let publishedAt = remoteResult ? (remoteResult.publishedAt || '') : '';
  if (!publishedAt) {
    publishedAt = await getVersionTime(name, remote) || '';
    if (publishedAt) {
      writeCache(remote, publishedAt);
    }
  }
  const lagDays = calcLagDays(publishedAt);

  return { outdated, local, remote, lagDays };
}

/**
 * Compare two semver-like strings (e.g. "0.8.12" vs "0.8.13").
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Format an upgrade notification message for the given context.
 * @param {{ outdated: boolean, local: string, remote: string, lagDays: number }} result
 * @param {'cli'|'doctor'|'plugin'} context
 * @returns {string}
 */
function formatUpgradeMsg(result, context) {
  if (!result || !result.outdated || !result.remote) {
    if (context === 'cli') return `\u2713 xp-gate v${result?.local || 'unknown'} is up to date`;
    return '';
  }

  const releaseUrl = `https://github.com/boyingliu01/xp-gate/releases/tag/v${result.remote}`;
  const upgradeCmd = 'xp-gate upgrade --apply';

  switch (context) {
    case 'cli':
      return `A newer version v${result.remote} is available (${releaseUrl}) \u2014 run: ${upgradeCmd}`;
    case 'doctor':
      return `Remote: v${result.remote} \u2190 NEW (see: ${releaseUrl})\n  Run: ${upgradeCmd}`;
    case 'plugin': {
      if (result.lagDays < 1) return ''; // silent
      if (result.lagDays <= 7) return `Upgrade: v${result.remote} available \u2014 run: ${upgradeCmd}`;
      return `New version v${result.remote} available (you have v${result.local}) \u2014 upgrade recommended \u2014 run: ${upgradeCmd}`;
    }
    default:
      return '';
  }
}

module.exports = {
  getPackageName,
  getLocalVersion,
  getRemoteVersion,
  checkUpgrade,
  formatUpgradeMsg,
  compareVersions,
  clearCache,
  calcLagDays,
};
