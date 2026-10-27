#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REQUIRED_ROLES = ['architecture', 'technical', 'feasibility'];
const VALIDITY_MS = 60 * 60 * 1000;

/**
 * Project-level Delphi seat configuration.
 *
 * Present => evidence is BOUND to it (#574): each expert's `requested_model`
 * must be exactly the seat the config assigns to that expert's role.
 * Absent  => evidence stays unbound (the #423 behaviour), so projects that
 * review through another platform's channel are unaffected.
 */
const DELPHI_CONFIG_FILE = '.delphi-config.json';

/**
 * Allowed provenance values for an expert record.
 *
 * `channel` is an EXPLICIT whitelist. An absent field is rejected rather than
 * defaulted: treating "missing" as `local` (or as anything else) would be a
 * zero-cost bypass, since omitting one key would let evidence that never came
 * from a real model call pass the gate. Only these exact strings are accepted;
 * casing and whitespace are not normalised.
 */
const VALID_CHANNELS = ['external', 'local'];

function fail(message) {
  console.error(`Invalid code walkthrough evidence: ${message}`);
  process.exit(1);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseTimestamp(value, field) {
  const match = typeof value === 'string'
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/)
    : null;
  if (!match) fail(`${field} must be a canonical UTC ISO-8601 timestamp.`);

  // Groups 1..6 are year, month, day, hour, minute, second; group 7 is the
  // optional millisecond fraction. Keeping them as arrays means the "build the
  // date" and "verify round-trip" steps share one ordered definition instead of
  // repeating seven hand-numbered comparisons.
  const parts = match.slice(1, 7).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const milliseconds = Number((match[7] || '').padEnd(3, '0') || 0);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);

  // A date silently rolls over ("2026-02-30" becomes March 2), so the only way
  // to know the input was a real calendar instant is to read it back and compare
  // every field.
  const expected = [...parts, milliseconds];
  const readBack = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ];
  if (!readBack.every((actual, i) => actual === expected[i])) {
    fail(`${field} must contain a valid UTC calendar date and time.`);
  }
  return date.getTime();
}

/**
 * Record one seat into `seats` if the entry carries a usable model id.
 * Shared by both `experts` shapes so the acceptance rule lives in exactly one
 * place (#599: the two branches were byte-for-byte copies, which is what pushed
 * this function over the complexity block threshold).
 *
 * @param {Map<string, string>} seats role -> trimmed model id, mutated
 * @param {string} role configured role name
 * @param {unknown} entry candidate expert record
 */
function addSeat(seats, role, entry) {
  if (!isPlainObject(entry)) return;
  const model = entry.model ?? entry.requested_model;
  if (typeof model === 'string' && model.trim() !== '') seats.set(role, model.trim());
}

/**
 * Normalise the two `experts` shapes `.delphi-config.json` appears in — an
 * object keyed by role (what xp-gate writes) and an array carrying `role` —
 * into a plain role -> model map. Mirrors `normalizeExperts()` in
 * `plugins/dsh/src/delphi-config.ts` and `iter_seats()` in
 * `scripts/check_delphi_local_models.py`: one config shape, one reading.
 *
 * @param {unknown} experts raw `experts` value
 * @returns {Map<string, string>} role -> trimmed model id
 */
function seatsFromExperts(experts) {
  const seats = new Map();
  if (Array.isArray(experts)) {
    for (const entry of experts) {
      if (isPlainObject(entry) && typeof entry.role === 'string') {
        addSeat(seats, entry.role, entry);
      }
    }
  } else if (isPlainObject(experts)) {
    for (const [role, entry] of Object.entries(experts)) {
      addSeat(seats, role, entry);
    }
  }
  return seats;
}

/**
 * Resolve the binding seats from a parsed `.delphi-config.json`.
 *
 * Only the ACTIVE profile binds, exactly like every other Delphi loader. A
 * config that names profiles but leaves no resolvable active one is rejected
 * rather than ignored: silently falling back to "unbound" would turn a broken
 * config into a bypass.
 *
 * @param {unknown} config parsed config document
 * @returns {Map<string, string>} role -> model id that evidence must match
 */
function resolveBindingSeats(config) {
  if (!isPlainObject(config)) fail(`${DELPHI_CONFIG_FILE} must contain a JSON object.`);

  const profiles = config.profiles;
  if (!isPlainObject(profiles) || Object.keys(profiles).length === 0) {
    // Legacy/flat shape: experts live at the top level.
    return seatsFromExperts(config.experts);
  }

  const active = config.active_profile;
  if (typeof active !== 'string' || !isPlainObject(profiles[active])) {
    const available = Object.keys(profiles).join(', ');
    fail(
      `${DELPHI_CONFIG_FILE} has no resolvable active_profile (active_profile=${JSON.stringify(active)}; `
        + `available: ${available}). Set one so the gate knows which seats bind.`
    );
  }
  return seatsFromExperts(profiles[active].experts);
}

/**
 * Machine-wide Delphi config path: `$XDG_CONFIG_HOME/xp-gate/` or
 * `~/.config/xp-gate/`. Mirrors `defaultGlobalConfigPath()` in
 * `plugins/dsh/src/delphi-config.ts` so the gate and the tool that produces the
 * evidence agree on where seats come from. XDG_CONFIG_HOME is honoured because
 * the plugin honours it — a gate reading a different file than the reviewer
 * used would bind against seats nobody actually ran.
 */
function globalConfigPath(env = process.env) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'xp-gate', DELPHI_CONFIG_FILE);
}

/**
 * Read the binding seats for the project rooted at `projectRoot`.
 *
 * The root is passed EXPLICITLY by the caller, never derived from
 * `process.cwd()`. Deriving it from cwd made the binding depend on where the
 * validator was launched from: running the test suite from inside xp-gate
 * itself picked up xp-gate's own `.delphi-config.json` and re-bound every
 * fixture to xp-gate's seats. The gate's subject is the repository being
 * pushed, so that is what must be named.
 *
 * ## Global fallback (2026-10-27)
 *
 * A project file still WINS, so a repo can override seats deliberately. When
 * the project has none, the machine-wide config is used instead of returning
 * null — and this is load-bearing, not a convenience:
 *
 * Before this fallback existed, DELETING a project-level config silently
 * disabled the entire #574 seat check, because `bindingSeats === null`
 * short-circuits `validateRequestedModel`. The gate kept reporting PASS while
 * any three distinct gateway models — including the expensive overseas ones
 * #574 exists to catch — could satisfy it, with no message anywhere. A user
 * consolidating onto one global config to stop maintaining a copy per repo
 * would have unknowingly traded that protection away.
 *
 * Only ENOENT triggers the fallback: an unreadable project config
 * (EACCES/EISDIR) must surface rather than silently routing this run to a
 * different file. Same semantics as `loadDelphiConfig()` in the DSH plugin.
 *
 * @param {string} projectRoot repository root whose config binds the evidence
 * @param {NodeJS.ProcessEnv} env environment for the global-path lookup
 * @returns {Map<string, string> | null} seats, or null when NO config exists
 *          anywhere (evidence then stays unbound, the #423 behaviour)
 */
function loadBindingSeats(projectRoot, env = process.env) {
  const projectPath = path.join(projectRoot, DELPHI_CONFIG_FILE);
  const fallbackPath = globalConfigPath(env);

  let raw;
  let source = projectPath;
  try {
    raw = fs.readFileSync(projectPath, 'utf8');
  } catch (projectError) {
    if (projectError && projectError.code === 'ENOENT') {
      try {
        raw = fs.readFileSync(fallbackPath, 'utf8');
        source = fallbackPath;
      } catch (globalError) {
        if (globalError && globalError.code === 'ENOENT') return null;
        fail(
          `cannot read ${DELPHI_CONFIG_FILE}: ${globalError && globalError.message
            ? globalError.message
            : String(globalError)}`
        );
      }
    } else {
      fail(
        `cannot read ${DELPHI_CONFIG_FILE}: ${projectError && projectError.message
          ? projectError.message
          : String(projectError)}`
      );
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`${source} is not valid JSON: ${error.message}`);
  }
  const seats = resolveBindingSeats(parsed);
  for (const role of REQUIRED_ROLES) {
    if (!seats.has(role)) {
      fail(`${DELPHI_CONFIG_FILE} declares no seat for the ${role} role; all three roles must be configured.`);
    }
  }
  return seats;
}

/**
 * Validate an expert's identity fields: shape, role, approval status, and
 * channel provenance. Split out of `validateExpert`, which exceeded the
 * complexity block threshold (#599).
 *
 * @param {object} expert expert record
 * @param {number} index position in the experts array
 * @param {Set<string>} roles roles seen so far; the role is added
 */
function validateExpertIdentity(expert, index, roles) {
  if (!isPlainObject(expert)) fail(`experts[${index}] must be a plain object.`);
  if (!REQUIRED_ROLES.includes(expert.role)) fail(`experts[${index}].role is invalid.`);
  if (roles.has(expert.role)) fail(`expert role ${expert.role} is duplicated.`);
  roles.add(expert.role);

  if (expert.verdict !== 'APPROVED') fail(`expert ${expert.role} must be APPROVED.`);
  if (expert.result_type !== 'delphi_expert_result') {
    fail(`expert ${expert.role} must be a successful Delphi expert result.`);
  }
  if (expert.error !== undefined || expert.fallback !== undefined) {
    fail(`expert ${expert.role} contains an error or fallback marker.`);
  }

  // Provenance is mandatory and must be an exact whitelist value (#423). Without
  // this, three hand-written records with distinct model NAMES satisfied the old
  // check while no model was ever called.
  if (!VALID_CHANNELS.includes(expert.channel)) {
    fail(
      `expert ${expert.role} channel must be one of: ${VALID_CHANNELS.join(', ')}.`
    );
  }
}

/**
 * Validate the requested model: non-empty, distinct across experts, and — when
 * the project binds seats — exactly the model configured for this role.
 *
 * requested_model is compared EXACTLY (after trimming) while resolved_model is
 * compared case-INSENSITIVELY. The asymmetry is intentional, not an oversight: a
 * requested ID is a case-sensitive gateway identifier and AGENTS.md requires
 * "three distinct trimmed requested model IDs", whereas resolved_model answers
 * "did these actually run on one model?" -- and gateways do report the same model
 * with different casing per call, which is how #423 slipped through. Pinned by
 * scripts/__tests__/gate-mw-provenance.test.cjs (AC-423-08).
 *
 * #574: when the project ships a `.delphi-config.json`, the seat this role was
 * configured with is the ONLY model allowed to report for it. Distinctness alone
 * was satisfiable by any three of the gateway's ~138 models -- measured
 * 2026-10-22, a walkthrough ran on s-deepseek-v4.1-flash / g-deepseek-v4-pro /
 * doubao-seed-2.0-pro while the config named three local-* seats, and this
 * validator passed it. Membership is checked per ROLE (not as a set) so a swapped
 * pair is rejected too: the role attribution would otherwise be a lie.
 *
 * @param {object} expert expert record
 * @param {Set<string>} models requested models seen so far; this one is added
 * @param {Map<string, string>|null} bindingSeats configured seats, or null
 */
function validateRequestedModel(expert, models, bindingSeats) {
  if (typeof expert.requested_model !== 'string' || expert.requested_model.trim() === '') {
    fail(`expert ${expert.role} requested_model must be non-empty.`);
  }
  const model = expert.requested_model.trim();
  if (models.has(model)) fail(`requested_model ${model} is duplicated.`);
  models.add(model);

  if (bindingSeats !== null) {
    const configured = bindingSeats.get(expert.role);
    if (model !== configured) {
      fail(
        `expert ${expert.role} requested_model ${model} does not match the configured seat `
          + `${configured} from ${DELPHI_CONFIG_FILE}.`
      );
    }
  }
}

/**
 * Validate the resolved model: a non-empty string, distinct ignoring case.
 *
 * Previously null was allowed, so an expert that never resolved a model still
 * counted as successful; and nothing compared resolved models, so all three could
 * report the same one while `requested_model` differed.
 *
 * @param {object} expert expert record
 * @param {Set<string>} resolvedModels resolved models seen so far; added here
 */
function validateResolvedModel(expert, resolvedModels) {
  if (typeof expert.resolved_model !== 'string' || expert.resolved_model.trim() === '') {
    fail(`expert ${expert.role} resolved_model must be a non-empty string.`);
  }
  const resolved = expert.resolved_model.trim().toLowerCase();
  if (resolvedModels.has(resolved)) {
    fail(`expert ${expert.role} resolved_model ${expert.resolved_model.trim()} is duplicated.`);
  }
  resolvedModels.add(resolved);
}

function validateExpert(expert, index, roles, models, resolvedModels, bindingSeats) {
  validateExpertIdentity(expert, index, roles);
  validateRequestedModel(expert, models, bindingSeats);
  validateResolvedModel(expert, resolvedModels);
}

function validateEvidence(evidence, expectedCommit, expectedBranch, now, bindingSeats) {
  if (!isPlainObject(evidence)) fail('top level must be a plain object.');
  validateEvidenceIdentity(evidence, expectedCommit, expectedBranch);
  validateEvidenceTimestamps(evidence, now);
  validateConsensusRatio(evidence.consensus_ratio);
  validateExperts(evidence.experts, bindingSeats);
}

/** The document must describe this exact push, and must approve it. */
function validateEvidenceIdentity(evidence, expectedCommit, expectedBranch) {
  if (evidence.commit !== expectedCommit) fail('commit does not match HEAD.');
  if (evidence.branch !== expectedBranch) fail('branch does not match the current branch.');
  if (evidence.verdict !== 'APPROVED') fail('top-level verdict must be APPROVED.');
}

/**
 * The evidence must be recent and self-consistent: not from the future, not
 * expired, and valid for exactly one hour from its own timestamp.
 */
function validateEvidenceTimestamps(evidence, now) {
  const timestamp = parseTimestamp(evidence.timestamp, 'timestamp');
  const expires = parseTimestamp(evidence.expires, 'expires');
  if (timestamp > now) fail('timestamp is in the future.');
  if (expires <= now) fail('evidence has expired.');
  if (expires - timestamp !== VALIDITY_MS) {
    fail('expires must be exactly one hour after timestamp.');
  }
}

/** The three experts must have agreed at 90% or better. */
function validateConsensusRatio(ratio) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0.90 || ratio > 1) {
    fail('consensus_ratio must be a finite number from 0.90 through 1.');
  }
}

/**
 * Validate each of the three expert records, then confirm every required role
 * appeared. `roles` accumulates across the records, so it is checked once after
 * the loop rather than per expert.
 */
function validateExperts(experts, bindingSeats) {
  if (!Array.isArray(experts) || experts.length !== 3) {
    fail('experts must contain exactly three records.');
  }
  const roles = new Set();
  const models = new Set();
  // Scoped to this validation run, so one document's models cannot leak into the
  // next (a long-lived process validating several pushes).
  const resolvedModels = new Set();
  experts.forEach((expert, index) => {
    validateExpert(expert, index, roles, models, resolvedModels, bindingSeats);
  });
  if (roles.size !== REQUIRED_ROLES.length) fail('all required expert roles must be present.');
}

/**
 * Read and parse the evidence document, failing with a readable message rather
 * than letting a raw ENOENT/JSON.parse error escape.
 *
 * @param {string} file path to the evidence JSON
 * @returns {unknown} parsed document
 */
function readEvidence(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fail('file must exist and contain valid JSON.');
  }
}

/**
 * Resolve the project root the caller named, if any.
 *
 * #574: the seats that bind are the ones configured in the repository being
 * pushed. The caller names that root; a missing argument means "no project
 * context", which keeps evidence unbound rather than guessing from cwd.
 *
 * @param {string|undefined} projectRoot raw argv value
 * @returns {string|null} absolute root, or null for "no project context"
 */
function resolveProjectRoot(projectRoot) {
  if (projectRoot === undefined || projectRoot === '') return null;
  return path.resolve(projectRoot);
}

function main() {
  const [file, expectedCommit, expectedBranch, nowValue, projectRoot] = process.argv.slice(2);
  if (!file || !expectedCommit || !expectedBranch) {
    fail(`usage: validate-code-walkthrough.cjs <file> <commit> <branch> [now] [project-root].`);
  }

  const evidence = readEvidence(file);
  const now = nowValue === undefined ? Date.now() : parseTimestamp(nowValue, 'current time');

  const root = resolveProjectRoot(projectRoot);
  const bindingSeats = root === null ? null : loadBindingSeats(root);
  validateEvidence(evidence, expectedCommit, expectedBranch, now, bindingSeats);
}

main();
