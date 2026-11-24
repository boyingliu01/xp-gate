/**
 * Flaky-test governance (#603).
 *
 * The gap this closes: a flaky test and a genuine failure look identical in the
 * gate journal, so one of two wrong things happens — the flake gets treated as a
 * product bug and someone spends a day "fixing" nothing, or the real failure gets
 * re-run until it passes and slips through. Both are consequences of having no
 * data that separates the two.
 *
 * Three rules, each earned from a specific failure mode:
 *
 * 1. A re-run that passes does NOT count as a first pass. If `passed: true` counted
 *    the same regardless of how it was obtained, first-pass rate would be
 *    permanently 100% and the metric would measure nothing.
 * 2. Retries are capped, and the default is tiny. Unlimited retries turn a gate
 *    into "eventually something passes", which is a concession rather than
 *    governance.
 * 3. Quarantine entries expire. An entry with no expiry is a permanent deletion
 *    that merely still looks present.
 *
 * No runtime dependencies: this ships inside the zero-install package.
 */
'use strict';

const fs = require('node:fs');

/**
 * Hard ceiling on retries. Config may lower this but never raise it: the cap
 * exists so flakiness surfaces rather than being retried away.
 */
const MAX_RETRIES = 3;

/** Only schedule YAML is needed, so a tiny parser beats a dependency here. */
const FIELD_RE = /^\s*-\s+test:\s*(.+?)\s*$/
const KV_RE = /^\s+([A-Za-z_][\w]*):\s*(.*?)\s*$/

/** Whether `value` is wrapped in a matching pair of quotes of either kind. */
function isQuoted(value) {
  if (value.length < 2) return false
  const first = value[0]
  return (first === '"' || first === "'") && value[value.length - 1] === first
}

function stripQuotes(value) {
  return isQuoted(value) ? value.slice(1, -1) : value
}

/**
 * Parse `.flaky-quarantine.yaml`.
 *
 * Returns `[]` for a missing file: no ledger is not an error, it just means
 * nothing is quarantined. A malformed entry is skipped rather than throwing —
 * a broken ledger must not take down `doctor`.
 *
 * @param {string} filePath
 * @returns {Array<object>}
 */
/** Read the quarantine file, or [] when it cannot be read at all. */
function readQuarantineText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Parse the quarantine file into entries.
 *
 * The format is line-oriented: a `- test: <name>` line opens an entry, indented
 * `key: value` lines add fields, and comments or blank lines are ignored. The parser
 * therefore keeps ONE entry under construction and decides per line whether the line
 * opens a new entry, extends the current one, or is noise.
 *
 * @param {string} filePath
 * @returns {object[]}
 */
/** A line that carries no field: blank, or a comment. */
function isNoise(line) {
  return line === '' || line.startsWith('#')
}

function parseQuarantine(filePath) {
  const lines = readQuarantineText(filePath).split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const { entries, current } = lines.reduce(stepEntry, { entries: [], current: null });
  return current ? [...entries, current] : entries;
}

/**
 * Fold one line into the entry list.
 *
 * Kept as a reducer rather than a loop body: the loop needed three `continue`s to
 * express "noise", "opens a new entry" and "extends the current one", and three exits
 * from one loop is what put the parser over the complexity ceiling.
 *
 * @param {{entries: object[], current: object|null}} state
 * @param {string} line
 * @returns {{entries: object[], current: object|null}}
 */
function stepEntry(state, line) {
  if (isNoise(line)) return state;
  const opened = openEntry(line);
  if (opened) {
    return { entries: state.current ? [...state.entries, state.current] : state.entries, current: opened };
  }
  if (state.current) applyField(state.current, line);
  return state;
}

/**
 * A new entry if this line starts one, else null.
 *
 * @param {string} line
 * @param {object|null} current
 * @returns {object|null}
 */
function openEntry(line, current) {
  const start = FIELD_RE.exec(line)
  return start ? { test: stripQuotes(start[1]) } : null
}

/**
 * Apply a `key: value` line to the entry under construction.
 *
 * `critical_path` is the one field that is a BOOLEAN; every other field stays a
 * string. Anything that is not a key/value pair is ignored rather than stored under
 * an empty key.
 *
 * @param {object} entry mutated in place
 * @param {string} line
 */
function applyField(entry, line) {
  const kv = KV_RE.exec(line)
  if (!kv) return
  const [, key, rawValue] = kv
  const value = stripQuotes(rawValue)
  entry[key] = key === 'critical_path' ? value === 'true' : value
}

/** Parse an `YYYY-MM-DD` expiry into a UTC midnight Date, or null. */
function parseExpiry(value) {
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Entries whose expiry has passed. An unparseable expiry counts as expired. */
function findExpiredQuarantine(entries, now) {
  const at = now || new Date()
  return entries.filter((entry) => {
    const expiry = parseExpiry(entry.expiry)
    // No expiry at all is treated as expired: rule 3 says quarantine without an
    // end date is a permanent deletion, so it must be reported, not tolerated.
    if (expiry === null) return true
    return expiry.getTime() < at.getTime()
  })
}

/**
 * Policy violations across the ledger.
 *
 * Two distinct rules are reported separately because they need different
 * responses: an expired entry is routine bookkeeping, whereas a critical-path
 * entry is a decision someone has to make — a critical path that has been flaky
 * for months means the team has stopped trusting its own safety net.
 */
function findPolicyViolations(entries, now) {
  const at = now || new Date()
  const expired = new Set(findExpiredQuarantine(entries, at))
  // One pass: a quarantined entry on the critical path is reported as `expired`,
  // not twice. Two loops needed a `some()` scan to express that, which is what made
  // this a branch.
  return entries.flatMap((entry) => {
    if (expired.has(entry)) return [{ rule: 'expired', entry }]
    if (entry.critical_path) return [{ rule: 'critical-path-quarantined', entry }]
    return []
  })
}

/**
 * Resolve the retry budget from configuration.
 *
 * Clamped, not validated-with-an-error: a bad value must not make the gate
 * unusable, and the direction of clamping always favours surfacing flakiness.
 */
/** The default when a retry count is absent or unparseable. */
const DEFAULT_MAX_RETRIES = 1

function resolveMaxRetries(value) {
  if (value == null || value === '') return DEFAULT_MAX_RETRIES
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed)) return DEFAULT_MAX_RETRIES
  // A negative count means "no retries", not "the default": it was explicit.
  return Math.max(0, Math.min(parsed, MAX_RETRIES))
}

/** Round to one decimal place without trailing `.0`. */
function pct(part, whole) {
  if (whole === 0) return null
  return Math.round((part / whole) * 1000) / 10
}

/**
 * Compute first-pass and flaky statistics from gate-journal entries.
 *
 * Records carry `attempt` (1-based). A record with `attempt > 1` is a re-run and
 * is excluded from the first-attempt denominator — that exclusion IS the metric.
 */
/**
 * Fold one journal row into the counters.
 *
 * A row's `attempt` is 1-based and may be absent on older records, in which case it
 * counts as a first attempt. A row that needed a re-run counts as a RERUN, not as a
 * first attempt -- counting it in both would inflate the denominator and make the
 * flaky rate look better than it is.
 *
 * @param {object} c counters, mutated
 * @param {object} row
 */
/** A row's attempt number, defaulting to 1 when the field is absent or unusable. */
function attemptOf(row) {
  return Number.isFinite(row.attempt) ? row.attempt : 1;
}

/**
 * Fold one journal row into the counters.
 *
 * A row that needed a re-run counts as a RERUN, not as a first attempt -- counting it
 * in both would inflate the denominator and make the flaky rate look better than it
 * is.
 *
 * @param {object} c counters, mutated
 * @param {object} row
 */
function accumulateRow(c, row) {
  if (!row || typeof row !== 'object') return;
  if (row.quarantined === true) c.quarantined += 1;
  const isRerun = attemptOf(row) > 1;
  const bucket = isRerun ? 'rerun' : 'first';
  countAttempt(c, bucket, row.passed === true);
}

/**
 * Credit one attempt to its bucket.
 *
 * @param {object} c counters, mutated
 * @param {'first'|'rerun'} bucket
 * @param {boolean} passed
 */
function countAttempt(c, bucket, passed) {
  if (bucket === 'rerun') {
    c.reruns += 1;
    if (passed) c.flakyRecoveries += 1;
    return;
  }
  c.firstAttempts += 1;
  if (passed) c.firstPasses += 1;
}

function computeFlakyStats(entries) {
  const rows = Array.isArray(entries) ? entries : []
  const c = { firstAttempts: 0, firstPasses: 0, flakyRecoveries: 0, reruns: 0, quarantined: 0 };
  for (const row of rows) accumulateRow(c, row);

  return buildStats({ totalRuns: rows.length, ...c });
}

/**
 * Assemble the stats object, including the measured/unmeasured distinction.
 *
 * Without any re-run there is no evidence either way: reporting `flakyRate: 0` would
 * claim "measured, and stable" from data that only says "not measured". The rate is
 * therefore `null` with a reason, and `measurable` is what the caller branches on.
 *
 * @param {{totalRuns: number, firstAttempts: number, firstPasses: number,
 *   reruns: number, flakyRecoveries: number, quarantined: number}} c counters
 * @returns {object}
 */
function buildStats(c) {
  const measurable = c.reruns > 0;
  return {
    totalRuns: c.totalRuns,
    firstAttempts: c.firstAttempts,
    firstPasses: c.firstPasses,
    firstPassRate: pct(c.firstPasses, c.firstAttempts),
    reruns: c.reruns,
    flakyRecoveries: c.flakyRecoveries,
    quarantined: c.quarantined,
    flakyRate: measurable ? pct(c.flakyRecoveries, c.firstAttempts + c.reruns) : null,
    measurable,
    reason: measurable
      ? null
      : 'no re-run records in the journal — flakiness is unmeasured, not zero',
  };
}

module.exports = {
  MAX_RETRIES,
  parseQuarantine,
  parseExpiry,
  findExpiredQuarantine,
  findPolicyViolations,
  resolveMaxRetries,
  computeFlakyStats,
}
