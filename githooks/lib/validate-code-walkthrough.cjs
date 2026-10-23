#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const milliseconds = Number((fractionText || '').padEnd(3, '0') || 0);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);

  if (date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
      || date.getUTCHours() !== hour
      || date.getUTCMinutes() !== minute
      || date.getUTCSeconds() !== second
      || date.getUTCMilliseconds() !== milliseconds) {
    fail(`${field} must contain a valid UTC calendar date and time.`);
  }
  return date.getTime();
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
      if (!isPlainObject(entry) || typeof entry.role !== 'string') continue;
      const model = entry.model ?? entry.requested_model;
      if (typeof model === 'string' && model.trim() !== '') seats.set(entry.role, model.trim());
    }
    return seats;
  }
  if (isPlainObject(experts)) {
    for (const [role, entry] of Object.entries(experts)) {
      if (!isPlainObject(entry)) continue;
      const model = entry.model ?? entry.requested_model;
      if (typeof model === 'string' && model.trim() !== '') seats.set(role, model.trim());
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
 * Read the binding seats for the project rooted at `projectRoot`.
 *
 * The root is passed EXPLICITLY by the caller, never derived from
 * `process.cwd()`. Deriving it from cwd made the binding depend on where the
 * validator was launched from: running the test suite from inside xp-gate
 * itself picked up xp-gate's own `.delphi-config.json` and re-bound every
 * fixture to xp-gate's seats. The gate's subject is the repository being
 * pushed, so that is what must be named.
 *
 * @param {string} projectRoot repository root whose config binds the evidence
 * @returns {Map<string, string> | null} seats, or null when no config exists
 */
function loadBindingSeats(projectRoot) {
  const configPath = path.join(projectRoot, DELPHI_CONFIG_FILE);
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    fail(`cannot read ${DELPHI_CONFIG_FILE}: ${error && error.message ? error.message : String(error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`${DELPHI_CONFIG_FILE} is not valid JSON: ${error.message}`);
  }
  const seats = resolveBindingSeats(parsed);
  for (const role of REQUIRED_ROLES) {
    if (!seats.has(role)) {
      fail(`${DELPHI_CONFIG_FILE} declares no seat for the ${role} role; all three roles must be configured.`);
    }
  }
  return seats;
}

function validateExpert(expert, index, roles, models, resolvedModels, bindingSeats) {
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

  // requested_model is compared EXACTLY (after trimming); resolved_model below is
  // compared case-INSENSITIVELY. The asymmetry is intentional, not an oversight:
  // a requested ID is a case-sensitive gateway identifier and AGENTS.md requires
  // "three distinct trimmed requested model IDs", whereas resolved_model answers
  // "did these actually run on one model?" -- and gateways do report the same model
  // with different casing per call, which is how #423 slipped through. Pinned by
  // scripts/__tests__/gate-mw-provenance.test.cjs (AC-423-08).
  if (typeof expert.requested_model !== 'string' || expert.requested_model.trim() === '') {
    fail(`expert ${expert.role} requested_model must be non-empty.`);
  }
  const model = expert.requested_model.trim();
  if (models.has(model)) fail(`requested_model ${model} is duplicated.`);
  models.add(model);

  // #574: when the project ships a `.delphi-config.json`, the seat this role was
  // configured with is the ONLY model allowed to report for it. Distinctness
  // alone was satisfiable by any three of the gateway's ~138 models -- measured
  // 2026-10-22, a walkthrough ran on s-deepseek-v4.1-flash / g-deepseek-v4-pro /
  // doubao-seed-2.0-pro while the config named three local-* seats, and this
  // validator passed it. Membership is checked per ROLE (not as a set) so a
  // swapped pair is rejected too: the role attribution would otherwise be a lie.
  if (bindingSeats !== null) {
    const configured = bindingSeats.get(expert.role);
    if (model !== configured) {
      fail(
        `expert ${expert.role} requested_model ${model} does not match the configured seat `
          + `${configured} from ${DELPHI_CONFIG_FILE}.`
      );
    }
  }

  // `resolved_model` must be a real, DISTINCT model. Previously null was allowed,
  // so an expert that never resolved a model still counted as successful; and
  // nothing compared resolved models, so all three could report the same one
  // while `requested_model` differed.
  if (typeof expert.resolved_model !== 'string' || expert.resolved_model.trim() === '') {
    fail(`expert ${expert.role} resolved_model must be a non-empty string.`);
  }
  const resolved = expert.resolved_model.trim().toLowerCase();
  if (resolvedModels.has(resolved)) {
    fail(`expert ${expert.role} resolved_model ${expert.resolved_model.trim()} is duplicated.`);
  }
  resolvedModels.add(resolved);
}

function validateEvidence(evidence, expectedCommit, expectedBranch, now, bindingSeats) {
  if (!isPlainObject(evidence)) fail('top level must be a plain object.');
  if (evidence.commit !== expectedCommit) fail('commit does not match HEAD.');
  if (evidence.branch !== expectedBranch) fail('branch does not match the current branch.');
  if (evidence.verdict !== 'APPROVED') fail('top-level verdict must be APPROVED.');

  const timestamp = parseTimestamp(evidence.timestamp, 'timestamp');
  const expires = parseTimestamp(evidence.expires, 'expires');
  if (timestamp > now) fail('timestamp is in the future.');
  if (expires <= now) fail('evidence has expired.');
  if (expires - timestamp !== VALIDITY_MS) {
    fail('expires must be exactly one hour after timestamp.');
  }

  if (typeof evidence.consensus_ratio !== 'number'
      || !Number.isFinite(evidence.consensus_ratio)
      || evidence.consensus_ratio < 0.90
      || evidence.consensus_ratio > 1) {
    fail('consensus_ratio must be a finite number from 0.90 through 1.');
  }

  if (!Array.isArray(evidence.experts) || evidence.experts.length !== 3) {
    fail('experts must contain exactly three records.');
  }
  const roles = new Set();
  const models = new Set();
  // Scoped to this validation run, so one document's models cannot leak into the
  // next (a long-lived process validating several pushes).
  const resolvedModels = new Set();
  evidence.experts.forEach((expert, index) => {
    validateExpert(expert, index, roles, models, resolvedModels, bindingSeats);
  });
  if (roles.size !== REQUIRED_ROLES.length) fail('all required expert roles must be present.');
}

function main() {
  const [file, expectedCommit, expectedBranch, nowValue, projectRoot] = process.argv.slice(2);
  if (!file || !expectedCommit || !expectedBranch) {
    fail(`usage: validate-code-walkthrough.cjs <file> <commit> <branch> [now] [project-root].`);
  }

  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail('file must exist and contain valid JSON.');
  }
  const now = nowValue === undefined ? Date.now() : parseTimestamp(nowValue, 'current time');
  // #574: the seats that bind are the ones configured in the repository being
  // pushed. The caller names that root; a missing argument means "no project
  // context", which keeps evidence unbound rather than guessing from cwd.
  const root = projectRoot === undefined || projectRoot === '' ? null : path.resolve(projectRoot);
  const bindingSeats = root === null ? null : loadBindingSeats(root);
  validateEvidence(evidence, expectedCommit, expectedBranch, now, bindingSeats);
}

main();
