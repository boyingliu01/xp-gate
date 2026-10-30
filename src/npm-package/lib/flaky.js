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

function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
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
function parseQuarantine(filePath) {
  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  const entries = []
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (line === '' || line.startsWith('#')) continue
    const start = FIELD_RE.exec(line)
    if (start) {
      if (current) entries.push(current)
      current = { test: stripQuotes(start[1]) }
      continue
    }
    if (!current) continue
    const kv = KV_RE.exec(line)
    if (!kv) continue
    const key = kv[1]
    const value = stripQuotes(kv[2])
    if (key === 'critical_path') {
      current.critical_path = value === 'true'
    } else {
      current[key] = value
    }
  }
  if (current) entries.push(current)
  return entries
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
  const violations = []
  for (const entry of findExpiredQuarantine(entries, at)) {
    violations.push({ rule: 'expired', entry })
  }
  for (const entry of entries) {
    if (entry.critical_path && !violations.some((v) => v.entry === entry)) {
      violations.push({ rule: 'critical-path-quarantined', entry })
    }
  }
  return violations
}

/**
 * Resolve the retry budget from configuration.
 *
 * Clamped, not validated-with-an-error: a bad value must not make the gate
 * unusable, and the direction of clamping always favours surfacing flakiness.
 */
function resolveMaxRetries(value) {
  if (value === undefined || value === null || value === '') return 1
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed)) return 1
  if (parsed < 0) return 0
  return Math.min(parsed, MAX_RETRIES)
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
function computeFlakyStats(entries) {
  const rows = Array.isArray(entries) ? entries : []
  let firstAttempts = 0
  let firstPasses = 0
  let flakyRecoveries = 0
  let reruns = 0
  let quarantined = 0

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (row.quarantined === true) quarantined += 1
    const attempt = Number.isFinite(row.attempt) ? row.attempt : 1
    if (attempt > 1) {
      reruns += 1
      if (row.passed === true) flakyRecoveries += 1
      continue
    }
    firstAttempts += 1
    if (row.passed === true) firstPasses += 1
  }

  const measurable = reruns > 0
  return {
    totalRuns: rows.length,
    firstAttempts,
    firstPasses,
    firstPassRate: pct(firstPasses, firstAttempts),
    reruns,
    flakyRecoveries,
    quarantined,
    // Without any re-run there is no evidence either way. Reporting 0 here would
    // claim "measured, and stable" from data that only says "not measured".
    flakyRate: measurable ? pct(flakyRecoveries, firstAttempts + reruns) : null,
    measurable,
    reason: measurable
      ? null
      : 'no re-run records in the journal — flakiness is unmeasured, not zero',
  }
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
