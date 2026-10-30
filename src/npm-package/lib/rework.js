/**
 * `xp-gate rework` — what the gate journal says about rework (#651).
 *
 * `xp-gate retro` already answers "how much did we ship". This answers the
 * narrower and more actionable question: how often does a round of work clear
 * the gates on the first attempt, and which rule stops it most.
 *
 * The reason this needs a dedicated command rather than a `retro` line: before
 * #651 the journal contained NO failure records at all, so a naive rework rate
 * computed from it returned 100% every time. A metric that reads "perfect" when
 * it is actually unmeasured is worse than no metric -- it manufactures
 * confidence. So `measurable: false` is a first-class outcome here.
 *
 * No runtime dependencies: this ships inside the zero-install package.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AUDIT_DIR = '.xp-gate';
const AUDIT_FILE = 'audit.jsonl';
const PENDING_FILE = 'audit.pending.jsonl';

/** Bucket name for failures the journal cannot attribute to a rule. */
const UNATTRIBUTED = 'unattributed';

/**
 * Read every journal record under `repoRoot`, oldest first.
 *
 * Malformed lines are skipped rather than thrown on: the journal is append-only
 * and a single truncated write must not take the whole report down.
 *
 * @param {string} [repoRoot]
 * @returns {Array<object>}
 */
function readJournal(repoRoot = process.cwd()) {
  const dir = path.join(repoRoot, AUDIT_DIR);
  const entries = [];
  for (const file of [AUDIT_FILE, PENDING_FILE]) {
    const full = path.join(dir, file);
    let raw;
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object') entries.push(parsed);
      } catch {
        /* truncated/garbled line -- skip, do not fail the report */
      }
    }
  }
  return entries;
}

/** Median of a numeric array (0 for an empty array). */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Mean of a numeric array (0 for an empty array). */
function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Group a flat record list into rework rounds.
 *
 * The journal is a flat stream of gate executions with no round identifier, so a
 * round is reconstructed the only way the data allows: a run of FAIL records
 * terminated by the next PASS. That is exactly "how many attempts before this
 * landed", which is the definition rework needs. A trailing run of failures with
 * no resolving pass is a round that has not landed yet, and is counted as
 * `unresolved` rather than being dropped.
 *
 * @param {Array<object>} entries
 */
function groupRounds(entries) {
  const rounds = [];
  let current = 0;
  for (const entry of entries) {
    if (entry.passed) {
      if (current > 0) rounds.push(current);
      current = 0;
      continue;
    }
    current += 1;
  }
  return { resolved: rounds, unresolved: current };
}

/**
 * Aggregate the journal into rework metrics.
 *
 * @param {Array<object>} entries journal records
 * @returns {object} see AC-670-59..62
 */
function computeReworkStats(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const totals = list.length;
  const failures = list.filter((e) => e.passed === false).length;
  const passes = totals - failures;

  // ── Failures by reason ────────────────────────────────────────────────────
  // Unlabelled failures are bucketed, never dropped: dropping them would lower
  // the failure count and push the first-pass rate UP, which is the optimistic
  // direction and therefore the dangerous one.
  const byReason = new Map();
  for (const entry of list) {
    if (entry.passed !== false) continue;
    const raw = typeof entry.failure_reason === 'string' ? entry.failure_reason.trim() : '';
    const key = raw === '' ? UNATTRIBUTED : raw;
    byReason.set(key, (byReason.get(key) || 0) + 1);
  }
  const topFailures = [...byReason.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  // ── Durations ─────────────────────────────────────────────────────────────
  // Two independent guards, because the flag alone is not enough:
  //
  //  1. honour `duration_anomaly` -- the writer's own verdict;
  //  2. reject implausible magnitudes. Measured on the real journal: 391 records
  //     carry the flag, but 6 MORE epoch-sized values (up to 1.78e12) do not,
  //     so trusting the flag alone left the mean at 1.3e9 ms -- the very
  //     "average 430 million seconds" artifact this is supposed to kill.
  //
  // The ceiling is deliberately generous (1 hour): a real gate run that long is
  // pathological but conceivable, while an epoch stamp is ~1.78e12 and cannot be
  // mistaken for anything else.
  const MAX_PLAUSIBLE_DURATION_MS = 60 * 60 * 1000;
  const isPlausible = (e) => typeof e.duration_ms === 'number'
    && Number.isFinite(e.duration_ms)
    && e.duration_ms >= 0
    && e.duration_ms <= MAX_PLAUSIBLE_DURATION_MS
    && e.duration_anomaly !== true;
  const sane = list.filter(isPlausible);
  const duration = sane.length > 0
    ? {
      medianMs: median(sane.map((e) => e.duration_ms)),
      meanMs: Math.round(mean(sane.map((e) => e.duration_ms))),
      samples: sane.length,
      // Every record that did NOT contribute -- flagged or implausible. Reporting
      // only the flagged count would understate the exclusion and make the
      // sample size look closer to the record count than it is.
      excludedAnomalies: list.filter((e) => typeof e.duration_ms === 'number' && !isPlausible(e)).length,
    }
    : null;

  // ── Rounds ────────────────────────────────────────────────────────────────
  const rounds = groupRounds(list);
  const reworkRounds = rounds.resolved;

  // ── First-pass rate ───────────────────────────────────────────────────────
  // Undefined without failures. A rate over an empty failure set is not 100%.
  const measurable = failures > 0;
  const firstPassRate = measurable ? Math.round((passes / totals) * 1000) / 10 : null;

  return {
    measurable,
    reason: measurable ? null : 'no failure records in the journal -- first-pass rate is not measurable (pre-#651 journals only recorded passes)',
    totalRecords: totals,
    passes,
    failures,
    firstPassRate,
    rounds: {
      resolved: reworkRounds.length,
      unresolved: rounds.unresolved > 0,
      medianRework: median(reworkRounds),
      meanRework: Math.round(mean(reworkRounds) * 100) / 100,
      worstRework: reworkRounds.length > 0 ? Math.max(...reworkRounds) : 0,
    },
    topFailures,
    duration,
  };
}

/** Render a stats object for the terminal. */
function formatReworkReport(stats, { limit = 10 } = {}) {
  const lines = [];
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('   REWORK REPORT');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(`  Journal records: ${stats.totalRecords}  (${stats.passes} pass, ${stats.failures} fail)`);

  if (!stats.measurable) {
    // Say WHY, and say it loudly: a silent 100% would be a lie.
    lines.push('');
    lines.push('  ⚠️  First-pass rate: NOT MEASURABLE');
    lines.push(`     ${stats.reason}`);
  } else {
    lines.push(`  First-pass rate: ${stats.firstPassRate}%`);
  }

  if (stats.rounds.resolved > 0) {
    lines.push('');
    lines.push(`  Rework rounds (failures before a landing): ${stats.rounds.resolved}`);
    lines.push(`     median ${stats.rounds.medianRework} / mean ${stats.rounds.meanRework} / worst ${stats.rounds.worstRework}`);
    if (stats.rounds.unresolved) {
      lines.push('     (a trailing run of failures has not landed yet)');
    }
  }

  if (stats.topFailures.length > 0) {
    lines.push('');
    lines.push(`  Top ${limit} blocking reasons:`);
    for (const { reason, count } of stats.topFailures.slice(0, limit)) {
      lines.push(`     ${String(count).padStart(5)}  ${reason}`);
    }
  }

  if (stats.duration) {
    lines.push('');
    lines.push(`  Gate duration: median ${stats.duration.medianMs} ms / mean ${stats.duration.meanMs} ms (${stats.duration.samples} samples`);
    lines.push(`                 ${stats.duration.excludedAnomalies} anomaly record(s) excluded)`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * CLI entry.
 * @param {string[]} argv args after `rework`
 */
function main(argv = []) {
  const repoRootIdx = argv.indexOf('--dir');
  const repoRoot = repoRootIdx !== -1 && argv[repoRootIdx + 1] ? argv[repoRootIdx + 1] : process.cwd();
  const limitIdx = argv.indexOf('--top');
  const limit = limitIdx !== -1 && argv[limitIdx + 1] ? parseInt(argv[limitIdx + 1], 10) : 10;

  const stats = computeReworkStats(readJournal(repoRoot));
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${formatReworkReport(stats, { limit })}\n`);
  return 0;
}

module.exports = {
  readJournal,
  computeReworkStats,
  formatReworkReport,
  main,
  UNATTRIBUTED,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
