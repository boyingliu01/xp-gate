#!/usr/bin/env node
'use strict';

/**
 * C0 License Verification Gate (v0.18.0 Phase C0)
 *
 * Verifies that mattpocock/skills ships a permissive (MIT) license before the
 * 4 built-in Matt Pocock skills (grilling, grill-with-docs, batch-grill-me,
 * domain-modeling) are packed into the npm distribution. Design doc §6/§12/§16.4:
 * a confirmed permissive license is a publish blocker; without it the skills
 * must be clean-room rewritten from the functional spec instead of copied.
 *
 * Flow:
 *   1. Fetch https://raw.githubusercontent.com/mattpocock/skills/main/LICENSE
 *      (10s timeout, one retry). On success, refresh the offline cache.
 *   2. On network failure, fall back to the offline cache
 *      (.xp-gate/mattpocock-license.cache.md).
 *   3. Validate the text is a compliant MIT license (regex: "MIT License"
 *      header + grant clause) and record SHA-256 as evidence.
 *   4. Write a verdict JSON to lib/mattpocock-license-verdict.json.
 *
 * Exit codes:
 *   0  PASS — MIT license confirmed (network or cache)
 *   1  FAIL — license obtained but NOT a compliant MIT license
 *   2  MISSING — license could not be obtained at all (triggers clean-room path)
 *
 * CLI flags:
 *   --offline             Skip network; use the offline cache only.
 *   --refresh             Re-fetch from network and update the cache
 *                         (default flow already does this; explicit for clarity).
 *   --force-clean-room    Record a clean-room rewrite decision to
 *                         .xp-gate/clean-room-decision.json and exit 0 for this
 *                         publish only (original skill text must NOT be copied).
 *
 * Env overrides (used by tests for hermetic execution):
 *   XPGATE_LICENSE_URL           license URL to fetch
 *   XPGATE_LICENSE_CACHE         offline cache file path
 *   XPGATE_LICENSE_VERDICT       verdict JSON output path
 *   XPGATE_CLEAN_ROOM_DECISION   clean-room decision JSON path
 *
 * Zero runtime dependencies (Node built-ins only).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');

const DEFAULT_LICENSE_URL = 'https://raw.githubusercontent.com/mattpocock/skills/main/LICENSE';
const NETWORK_TIMEOUT_MS = 10000;
const MAX_RETRIES = 1;
const MAX_REDIRECTS = 3;

const LICENSE_URL = process.env.XPGATE_LICENSE_URL || DEFAULT_LICENSE_URL;
const CACHE_PATH = process.env.XPGATE_LICENSE_CACHE || path.join(REPO_ROOT, '.xp-gate', 'mattpocock-license.cache.md');
const VERDICT_PATH = process.env.XPGATE_LICENSE_VERDICT || path.join(PKG_ROOT, 'lib', 'mattpocock-license-verdict.json');
const CLEAN_ROOM_PATH = process.env.XPGATE_CLEAN_ROOM_DECISION || path.join(REPO_ROOT, '.xp-gate', 'clean-room-decision.json');

const EXIT_PASS = 0;
const EXIT_FAIL = 1; // license obtained but non-compliant
const EXIT_MISSING = 2; // license missing/unrecognizable → clean-room path

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Validate that license text is a compliant MIT license.
 * Regex-based (tolerates copyright-year changes upstream) rather than a fixed
 * hash, with the SHA-256 recorded separately as tamper evidence.
 * @param {string} text
 * @returns {{ valid: boolean, licenseType: string|null, reason: string }}
 */
function validateLicense(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { valid: false, licenseType: null, reason: 'license text is empty' };
  }
  const hasMitHeader = /MIT License/i.test(text);
  const hasGrantClause = /Permission is hereby granted, free of charge/i.test(text);
  const hasNoWarranty = /THE SOFTWARE IS PROVIDED "AS IS"/i.test(text);
  const hasExpectedCopyright = /Copyright \(c\)\s+\d{4}\s+Matt Pocock/i.test(text);

  if (hasMitHeader && hasGrantClause && hasNoWarranty) {
    return {
      valid: true,
      licenseType: 'MIT',
      reason: hasExpectedCopyright
        ? 'MIT License with Matt Pocock copyright notice'
        : 'MIT License (copyright holder differs from expected "Matt Pocock")',
    };
  }
  return {
    valid: false,
    licenseType: null,
    reason: 'text does not match MIT License terms (missing "MIT License" header, grant clause, or warranty disclaimer)',
  };
}

/**
 * Fetch a URL, following up to MAX_REDIRECTS redirects.
 * Supports https: and http: (http only used by tests against a local server).
 * @param {string} url
 * @param {{ timeoutMs?: number, redirectsLeft?: number }} [options]
 * @returns {Promise<string>}
 */
function fetchUrl(url, options) {
  const timeoutMs = (options && options.timeoutMs) || NETWORK_TIMEOUT_MS;
  const redirectsLeft = options && typeof options.redirectsLeft === 'number' ? options.redirectsLeft : MAX_REDIRECTS;

  return new Promise((resolve, reject) => {
    let mod;
    if (url.startsWith('https:')) mod = https;
    else if (url.startsWith('http:')) mod = http;
    else {
      reject(new Error(`unsupported URL scheme: ${url}`));
      return;
    }

    const req = mod.get(url, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        fetchUrl(next, { timeoutMs, redirectsLeft: redirectsLeft - 1 }).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms fetching ${url}`));
    });
    req.on('error', reject);
  });
}

/**
 * Fetch with one retry after the initial attempt fails.
 * @param {string} url
 * @param {number} [retries]
 * @returns {Promise<string>}
 */
async function fetchWithRetry(url, retries) {
  const attempts = (typeof retries === 'number' ? retries : MAX_RETRIES) + 1;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchUrl(url);
    } catch (err) {
      lastErr = err;
      console.error(`[license-check] network attempt ${attempt}/${attempts} failed: ${err.message}`);
    }
  }
  throw lastErr;
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function handleForceCleanRoom() {
  const recordedAt = new Date().toISOString();
  const decision = {
    decision: 'clean-room-rewrite',
    recorded_at: recordedAt,
    note: 'mattpocock/skills LICENSE missing or non-compliant at publish time. '
      + 'The 4 built-in skills (grilling, grill-with-docs, batch-grill-me, domain-modeling) '
      + 'must be clean-room rewritten from the functional spec (interview discipline / '
      + 'CONTEXT.md+ADR formats / batch decision protocol) — original expression must NOT be copied.',
  };
  writeJson(CLEAN_ROOM_PATH, decision);
  writeJson(VERDICT_PATH, {
    verdict: 'FAIL',
    license_type: null,
    sha256: null,
    checked_at: recordedAt,
    source: 'clean-room-decision',
    clean_room: true,
  });
  console.error(`[license-check] clean-room decision recorded: ${CLEAN_ROOM_PATH}`);
  console.error('[license-check] WARNING: publishing under clean-room override — verbatim skill text must NOT be shipped until the rewrite lands.');
  process.exit(EXIT_PASS);
}

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const refresh = args.includes('--refresh');

  if (args.includes('--force-clean-room')) {
    handleForceCleanRoom();
    return;
  }

  let text = null;
  let source = null;

  if (offline) {
    console.error('[license-check] --offline: skipping network fetch');
  } else {
    if (refresh) console.error('[license-check] --refresh: re-fetching license from network');
    try {
      text = await fetchWithRetry(LICENSE_URL);
      source = 'network';
      // Refresh the offline cache on every successful network fetch.
      try {
        fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
        fs.writeFileSync(CACHE_PATH, text, 'utf8');
        console.error(`[license-check] offline cache updated: ${CACHE_PATH}`);
      } catch (cacheErr) {
        console.error(`[license-check] WARN: failed to update offline cache: ${cacheErr.message}`);
      }
    } catch (netErr) {
      console.error(`[license-check] network unavailable: ${netErr.message}`);
    }
  }

  if (text === null && fs.existsSync(CACHE_PATH)) {
    text = fs.readFileSync(CACHE_PATH, 'utf8');
    source = 'cache';
    console.error(`[license-check] using offline cache: ${CACHE_PATH}`);
  }

  const checkedAt = new Date().toISOString();

  if (text === null) {
    writeJson(VERDICT_PATH, {
      verdict: 'FAIL',
      license_type: null,
      sha256: null,
      checked_at: checkedAt,
      source: 'none',
      error: 'license missing: network fetch failed and no offline cache available',
    });
    console.error('[license-check] ERROR: mattpocock/skills LICENSE could not be obtained (network failed, no cache).');
    console.error('[license-check] This is a publish blocker (design §6 C0 license gate).');
    console.error('[license-check] Mitigation: start a clean-room rewrite of the 4 built-in skills from the functional spec,');
    console.error('[license-check]   or run `npm run license-check -- --force-clean-room` to record the clean-room rewrite path for this publish.');
    process.exit(EXIT_MISSING);
  }

  const result = validateLicense(text);
  const digest = sha256(text);

  if (!result.valid) {
    writeJson(VERDICT_PATH, {
      verdict: 'FAIL',
      license_type: result.licenseType,
      sha256: digest,
      checked_at: checkedAt,
      source,
      reason: result.reason,
    });
    console.error(`[license-check] FAIL: ${result.reason}`);
    console.error(`[license-check] sha256: ${digest} (source: ${source})`);
    console.error('[license-check] The license is NOT a compliant MIT license — verbatim redistribution of the skills is prohibited.');
    console.error('[license-check] Mitigation: run `npm run license-check -- --force-clean-room` to record the clean-room rewrite path.');
    process.exit(EXIT_FAIL);
  }

  writeJson(VERDICT_PATH, {
    verdict: 'PASS',
    license_type: 'MIT',
    sha256: digest,
    checked_at: checkedAt,
    source,
  });
  console.error(`[license-check] PASS: MIT License confirmed (${result.reason})`);
  console.error(`[license-check] sha256: ${digest}`);
  console.error(`[license-check] source: ${source}`);
  console.error(`[license-check] verdict written: ${VERDICT_PATH}`);
  process.exit(EXIT_PASS);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[license-check] unexpected error: ${err.message}`);
    process.exit(EXIT_MISSING);
  });
}

module.exports = {
  validateLicense,
  sha256,
  fetchUrl,
  fetchWithRetry,
  EXIT_PASS,
  EXIT_FAIL,
  EXIT_MISSING,
};
