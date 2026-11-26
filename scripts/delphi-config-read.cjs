'use strict';
/**
 * Reading a Delphi config file into the shape a review runs on.
 *
 * Split out of `delphi-external-review.cjs` when that file crossed its size ceiling.
 * The three helpers it borrows -- global-config resolution, env-placeholder expansion
 * and the consensus clamp -- stay with the caller and are passed in as `deps`: they are
 * shared with the argument layer, and importing them back would close a cycle.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  isNonEmptyString, isPlainObject, isValidTimeoutMs,
  clampConsensusSetting, expandEnvPlaceholder,
} = require('./delphi-model-validation.cjs');

/**
 * Whether this path is genuinely ABSENT, as opposed to unreadable.
 *
 * `statSync` distinguishes ENOENT from EACCES/EISDIR, and only the first is "absent":
 * treating a permission error as absence would silently route a run to another project's
 * config, which is how the 2026-10-03 quota incident happened.
 */
function isAbsent(configPath) {
  try {
    fs.statSync(configPath);
    return false;
  } catch (e) {
    return e.code === 'ENOENT';
  }
}

/**
 * Whether to look for the machine-wide config instead.
 *
 * Only when the project file is genuinely ABSENT and the caller gave a RELATIVE path: an
 * absolute path is an explicit request for that file, and falling back would answer a
 * different question than the one asked.
 */
function shouldFallBack(missingHere, configPath) {
  return missingHere && !path.isAbsolute(configPath);
}

function loadConfigFile(configPath) {
  // Global fallback: a relative --config that this cwd does not have resolves
  // to the machine-wide ~/.config/xp-gate/.delphi-config.json. This is what
  // makes `--config .delphi-config.json` work from ANY project without each
  // repo carrying its own (drifting, differently-priced) copy — reading a
  // foreign project's config used to route calls to expensive models
  // (2026-10-03 quota incident). An existing local file always wins.
  // Fallback fires ONLY when the project file is genuinely absent: statSync
  // distinguishes ENOENT from EACCES/EISDIR, and any other error aborts here
  // rather than silently routing this run to another config — matching the
  // TS loader's ENOENT-only semantics (walkthrough R10 FC-01).
  const missingHere = isAbsent(configPath);
  if (shouldFallBack(missingHere, configPath)) {
    // r16 MA-01 disposition: XDG_CONFIG_HOME is an accepted override for the
    // global config location. The CLI lib (shared-paths/doctor) intentionally
    // pins ~/.config/xp-gate — overriding only this loader would make the two
    // disagree. On Linux, $HOME/.config IS the XDG default, so behaviour there
    // is identical; the env var only matters for non-default setups.
    // Extracted so all three resolution points share one definition (REQ-636).
    const globalPath = globalConfigPath(process.env);
    if (fs.existsSync(globalPath)) {
      console.error(`[delphi-review] ${configPath} not found here — using global config ${globalPath}`);
      configPath = globalPath;
    }
  }
  if (!fs.existsSync(configPath)) {
    console.error(`[delphi-review] ERROR: Config file not found: ${configPath}`);
    console.error('[delphi-review] Copy .delphi-config.json.example to .delphi-config.json and fill in your API keys.');
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    // POSITION ONLY, never `err.message`. V8 quotes the surrounding TEXT in a JSON
    // syntax error -- measured: `Unexpected token '}', ...", "oops": }" is not valid JSON`
    // -- and a config that failed next to `"api_key": "sk-..."` would print that key into
    // CI logs (review technical CI-01).
    console.error(
      `[delphi-review] ERROR: Failed to parse config ${configPath}: `
        + 'invalid JSON. Check it with a JSON validator — the error position is not '
        + 'printed here because it would quote the file, keys included.',
    );
    process.exit(1);
  }
  return raw;
}

/**
 * Look up the named profile, or fail with the list of what IS available.
 *
 * Naming the alternatives is the whole value of the branch: "profile not found"
 * alone leaves the operator re-reading a file that may be perfectly valid under a
 * different key.
 *
 * @param {object} raw parsed config
 * @param {string} profileName
 * @returns {object}
 */
function requireProfile(raw, profileName) {
  const profile = raw.profiles?.[profileName];
  if (profile) return profile;
  console.error(`[delphi-review] ERROR: Profile "${profileName}" not found in config.`);
  console.error(`[delphi-review] Available profiles: ${Object.keys(raw.profiles || {}).join(', ')}`);
  process.exit(1);
  return profile;
}

/**
 * Expand every provider's `${VAR}` placeholders in place, after validating shape.
 *
 * `validateProviders` runs FIRST so a structurally broken provider is reported as
 * such rather than as a missing environment variable.
 *
 * @param {object} profile
 * @param {string} profileName
 * @returns {object} the providers map, with placeholders resolved in place
 */
function resolveProviderCredentials(profile, profileName) {
  const providers = profile.providers || {};
  validateProviders(providers, profileName);
  for (const [name, prov] of Object.entries(providers)) {
    prov.api_key = expandEnvPlaceholder(prov.api_key, 'api_key', profileName, name);
    prov.base_url = expandEnvPlaceholder(prov.base_url, 'base_url', profileName, name);
  }
  return providers;
}

/**
 * The experts map with each model trimmed.
 *
 * Trimmed because a config with a trailing newline in `model` would otherwise send a
 * model id the gateway does not know -- and the error would name a value that LOOKS
 * right, which is the worst kind to debug.
 */
function normalizeExperts(experts) {
  return Object.fromEntries(
    Object.entries(experts || {}).map(([role, expert]) => [
      role,
      { ...expert, model: typeof expert.model === 'string' ? expert.model.trim() : expert.model },
    ]),
  );
}

/**
 * The consensus settings, clamped to what the review can honestly claim.
 *
 * The 90 floor is a POLICY, not a default: a config may raise the bar, never lower it,
 * because a lower bar stops calling the result a consensus. The 5-round cap bounds
 * cost; the 1-round floor bounds meaning. Both clamps are recorded as warnings -- a
 * silently clamped threshold changes what "consensus" means on that machine.
 */
function resolveConsensus(raw, warnings) {
  const threshold = clampConsensusSetting(raw.consensus?.threshold_percent, {
    min: 90, max: Number.MAX_SAFE_INTEGER, fallback: 90, clamp: (n) => Math.max(90, n),
  });
  if (threshold.clamped) warnings.push('threshold_percent_clamped');

  const rounds = clampConsensusSetting(raw.consensus?.max_review_rounds, {
    min: 1, max: 5, fallback: 5, clamp: (n) => Math.min(5, Math.max(1, Math.trunc(n))),
  });
  if (rounds.clamped) warnings.push('max_review_rounds_clamped');

  return {
    ...(raw.consensus || {}),
    threshold_percent: threshold.value,
    max_review_rounds: rounds.value,
    distinct_models_required: true,
  };
}

function readConfig(configPath, profileOverride) {
  const raw = loadConfigFile(configPath);
  const profileName = profileOverride || raw.active_profile || 'default';
  const profile = requireProfile(raw, profileName);
  const warnings = [];
  // Opting OUT of distinct models is recorded, not obeyed: three names resolving to one
  // model is what makes a review anonymous only in appearance.
  if (raw.consensus?.distinct_models_required === false) warnings.push('distinct_models_required_forced');

  return {
    active_profile: profileName,
    providers: resolveProviderCredentials(profile, profileName),
    experts: normalizeExperts(profile.experts),
    consensus: resolveConsensus(raw, warnings),
    warnings,
  };
}

/**
 * The field that makes this provider unusable, or null when it is fine.
 *
 * Returned rather than thrown so the caller decides how loud to be -- and so the list
 * of rules reads as a list instead of as four side-effecting `fail()` calls.
 */
function providerProblem(provider) {
  if (!isPlainObject(provider)) return 'must be an object.';
  if (!isNonEmptyString(provider.base_url)) return 'must define a non-empty base_url.';
  if (!isNonEmptyString(provider.api_key)) return 'must define a non-empty api_key.';
  if (!hasValidTimeout(provider)) return 'timeout_ms must be an integer between 1000 and 600000.';
  return null;
}

/**
 * Whether an optional `timeout_ms` is usable when present.
 *
 * Absent is fine -- the caller falls back to the default; present-but-wrong is not,
 * because a malformed timeout silently becomes NaN at the exec boundary.
 */
function hasValidTimeout(provider) {
  return provider.timeout_ms === undefined || isValidTimeoutMs(provider.timeout_ms);
}

function validateProviders(providers, profileName) {
  for (const [name, provider] of Object.entries(providers)) {
    const problem = providerProblem(provider);
    if (!problem) continue;
    console.error(`[delphi-review] ERROR: profiles.${profileName}.providers.${name} ${problem}`);
    process.exit(1);
  }
}

module.exports = { readConfig, loadConfigFile, requireProfile, resolveProviderCredentials };
