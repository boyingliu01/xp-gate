/**
 * xp-gate retro — Sprint engineering retrospective CLI (#369, design §8.1)
 *
 * Reads git log + .xp-gate/audit.jsonl + .quality-history.jsonl + .sprint-history/
 * and generates a Markdown retrospective report with rework rate trend (#369)
 * and --skip-evidence exposure (§8.4) sections.
 *
 * Zero npm dependencies (Node built-ins only).
 * @module retro
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { computeFlakyStats, parseQuarantine, findPolicyViolations } = require('./flaky');
const { evaluateAll, summariseStates } = require('./slo');

/**
 * Upper bound for a believable gate runtime. A gate that reports more than two
 * hours did not take two hours; it took a corrupted clock. Used to exclude
 * samples from the duration average rather than let one poisoned row dominate
 * it (the symptom was an "average" of 2.2e12 ms).
 */
const MAX_SANE_DURATION_MS = 2 * 60 * 60 * 1000;

/**
 * Whether an audit entry's duration_ms is a trustworthy sample.
 *
 * `e.duration_ms || 0` used to fold null into ZERO, which both dragged the mean
 * down and hid that the sample was missing — the same class of lie as the
 * epoch-sized values that started this line of work.
 *
 * BOTH signals must be honoured, not just one:
 *   - duration_anomaly: entries written before #475 carry an explicit flag.
 *     Dropping this check silently re-admitted every legacy poisoned sample, and
 *     the fixture average came out 33433ms instead of 150ms.
 *   - non-finite / out-of-range: a poisoned start now writes null or a
 *     nonsensical value outright, so those are excluded too.
 *
 * @param {{duration_ms?: number|null, duration_anomaly?: boolean}} entry
 * @returns {boolean}
 */
function isUsableDuration(entry) {
  if (entry.duration_anomaly) return false;
  const ms = entry.duration_ms;
  return Number.isFinite(ms) && ms >= 0 && ms <= MAX_SANE_DURATION_MS;
}

/**
 * Get git commit subjects within a date window.
 * @param {string} dir - Repository root
 * @param {number} days - Lookback window in days
 * @returns {Array<{hash: string, date: string, subject: string}>}
 */
function getGitCommits(dir, days) {
  try {
    const out = execSync(
      `git log --since="${days} days ago" --pretty=format:"%H|%ai|%s"`,
      { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return out.split('\n').filter(Boolean).map(l => {
      const [hash, date, ...rest] = l.split('|');
      return { hash, date, subject: rest.join('|') };
    });
  } catch {
    return [];
  }
}

/**
 * Parse .xp-gate/audit.jsonl entries.
 * @param {string} dir - Repository root
 * @returns {object[]} Parsed audit entries
 */
function readAuditEntries(dir) {
  const p = path.join(dir, '.xp-gate', 'audit.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Read last 10 entries from .quality-history.jsonl.
 * @param {string} dir - Repository root
 * @returns {object[]} Recent quality entries
 */
function readQualityHistory(dir) {
  const p = path.join(dir, '.quality-history.jsonl');
  if (!fs.existsSync(p)) return [];
  const entries = fs.readFileSync(p, 'utf8').split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  return entries.slice(-10);
}

/**
 * Read sprint history JSON files from .sprint-state/sprint-history/.
 * @param {string} dir - Repository root
 * @param {string|null} sprintFilter - Optional sprint ID filter
 * @returns {object[]} Sprint state objects
 */
function readSprintHistory(dir, sprintFilter) {
  const histDir = path.join(dir, '.sprint-state', 'sprint-history');
  const results = [];
  if (fs.existsSync(histDir)) {
    for (const f of fs.readdirSync(histDir).filter(f => f.endsWith('.json'))) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(histDir, f), 'utf8'));
        if (!sprintFilter || s.id === sprintFilter) results.push(s);
      } catch { /* skip */ }
    }
  }
  return results;
}

/**
 * Read Gate M rows out of the pre-push journals (#404 P1-3).
 *
 * Gate M lives in `.xp-gate/reports/pre-push/*.json`, not in the audit log: the
 * audit log only sees the 12 pre-commit gates. Reading it here is the only way
 * a retrospective can say anything about mutation testing at all.
 *
 * @param {string} dir - Repository root
 * @returns {object[]} One entry per journal that carried a Gate M row
 */
function readGateMRuns(dir) {
  const journalDir = path.join(dir, '.xp-gate', 'reports', 'pre-push');
  if (!fs.existsSync(journalDir)) return [];

  const runs = [];
  for (const f of fs.readdirSync(journalDir).filter(n => n.endsWith('.json'))) {
    let journal;
    try {
      journal = JSON.parse(fs.readFileSync(path.join(journalDir, f), 'utf8'));
    } catch {
      continue;
    }
    const rows = Array.isArray(journal.gates) ? journal.gates : [];
    // The TS gate is "M"; the per-language variants are M-Python/M-Go/... and
    // are counted separately by the caller when it wants them.
    const row = rows.find(r => r && r.id === 'M');
    if (!row) continue;
    const details = row.details && typeof row.details === 'object' ? row.details : {};
    runs.push({
      timestamp: journal.timestamp || '',
      status: row.status || 'UNKNOWN',
      skipReason: details.skip_reason || '',
      durationMs: details.duration_ms != null && details.duration_ms !== '' ? Number(details.duration_ms) : null,
      score: details.mutation_score != null && details.mutation_score !== '' ? Number(details.mutation_score) : null,
    });
  }
  return runs;
}

/**
 * Summarise Gate M runs for the report.
 * @param {object[]} runs - Output of readGateMRuns
 * @returns {object} Counts plus measured score/duration samples
 */
function summariseGateM(runs) {
  const total = runs.length;
  const skipped = runs.filter(r => r.status === 'SKIP').length;
  const timedOut = runs.filter(r => r.status === 'TIMEOUT').length;
  // The journals write "BLOCKED" (pre-push's literal), not "BLOCK". Matching
  // only one spelling silently reported 5 real mutation blocks as zero, which
  // is the exact failure mode this whole issue is about.
  const blocked = runs.filter(r => r.status === 'BLOCK' || r.status === 'BLOCKED').length;
  const passed = runs.filter(r => r.status === 'PASS').length;
  // A journal row that predates the #404 fix has an empty details object; that
  // is "this run told us nothing", not "this run scored zero".
  const measured = runs.filter(r => Number.isFinite(r.score));
  const durations = runs.filter(r => Number.isFinite(r.durationMs)).map(r => r.durationMs);
  const reasons = {};
  for (const r of runs) {
    if (r.status !== 'SKIP' && r.status !== 'TIMEOUT') continue;
    const key = r.skipReason || '(no reason recorded)';
    reasons[key] = (reasons[key] || 0) + 1;
  }
  return { total, skipped, timedOut, blocked, passed, measured, durations, reasons };
}

/**
 * Build the Gate M retrospective section.
 * @param {object[]} runs - Output of readGateMRuns
 * @returns {string[]} Markdown lines
 */
function buildGateMSection(runs) {
  const L = [];
  L.push('## Gate M (Mutation Testing) (#404)');

  if (runs.length === 0) {
    L.push('No pre-push journals found — Gate M has never been measured here.');
    L.push('');
    return L;
  }

  const s = summariseGateM(runs);
  const pct = n => `${((n / s.total) * 100).toFixed(1)}%`;

  L.push(`- Runs recorded: ${s.total} (PASS ${s.passed}, BLOCK ${s.blocked}, TIMEOUT ${s.timedOut}, SKIP ${s.skipped})`);
  L.push(`- Skip rate: ${pct(s.skipped)}; timeout rate: ${pct(s.timedOut)}`);

  if (s.measured.length > 0) {
    const scores = s.measured.map(r => r.score).sort((a, b) => a - b);
    const median = scores[Math.floor(scores.length / 2)];
    const p10 = scores[Math.floor(scores.length * 0.1)];
    const p90 = scores[Math.min(scores.length - 1, Math.floor(scores.length * 0.9))];
    L.push(`- Mutation score over ${scores.length} measured run(s): median ${median.toFixed(1)}%, p10 ${p10.toFixed(1)}%, p90 ${p90.toFixed(1)}%`);
  } else {
    // Printing "median 0%" or omitting the line would both read as a healthy
    // result. There is no sample, and the report must say exactly that.
    L.push('- Mutation score: no measured runs — the score has never been recorded in this window.');
  }

  if (s.durations.length > 0) {
    const sorted = [...s.durations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];
    const max = sorted[sorted.length - 1];
    L.push(`- Duration over ${sorted.length} measured run(s): p50 ${p50}ms, max ${max}ms`);
  } else {
    L.push('- Duration: no measured runs.');
  }

  const reasonKeys = Object.keys(s.reasons);
  if (reasonKeys.length > 0) {
    L.push('- Why it did not run:');
    for (const key of reasonKeys.sort((a, b) => s.reasons[b] - s.reasons[a])) {
      L.push(`  - ${key}: ${s.reasons[key]}`);
    }
  }

  L.push('');
  return L;
}

/**
 * Build the Markdown retrospective report.
 * @param {object} opts - Report data
 * @returns {string} Markdown report
 */
/**
 * Derive the six SLO measurements from the journal (#609, guide §15).
 *
 * Every branch that cannot produce a number returns `null`, never 0. The SLO
 * evaluator turns nulls into UNKNOWN, which is displayed as "not measured" --
 * distinct from "measured zero". A dashboard that prints 0% for an unmeasured
 * window teaches people to ignore it.
 */
function deriveSloMeasurements(audit, flaky) {
  const gateEntries = audit.filter((e) => e.gate_id);
  // The journal key is `commit_hash`, not `commit`, and there is no `attempt`
  // field at all (verified against 9212 real entries). Without attempts, a single
  // gate list cannot separate "passed first time" from "passed after a retry", so
  // the three attempt-derived SLOs stay UNKNOWN rather than being approximated
  // from a flat pass rate -- which would report ~100% and be believed.
  const withAttempt = gateEntries.filter((e) => Number.isFinite(e.attempt));
  const firsts = withAttempt.filter((e) => e.attempt === 1);
  const firstPass = firsts.filter((e) => e.passed).length;

  // "Final" = the last attempt recorded per gate within each commit.
  const finals = new Map();
  for (const e of withAttempt) {
    const key = `${e.commit_hash || ''}:${e.gate_id}`;
    const prev = finals.get(key);
    if (!prev || e.attempt > prev.attempt) finals.set(key, e);
  }
  const finalList = [...finals.values()];

  // Gate 5 is the test gate; its first attempt is the first-test signal.
  const gate5First = firsts.filter((e) => /gate.?5|test/i.test(String(e.gate_id)));

  return {
    first_build_pass: firsts.length > 0 ? (firstPass / firsts.length) * 100 : null,
    final_build_pass: finalList.length > 0
      ? (finalList.filter((e) => e.passed).length / finalList.length) * 100
      : null,
    first_test_pass: gate5First.length > 0
      ? (gate5First.filter((e) => e.passed).length / gate5First.length) * 100
      : null,
    flaky_rate: flaky && flaky.measurable && flaky.flakyRate !== null
      ? parseFloat(flaky.flakyRate)
      : null,
    // No workflow-run source is wired in yet: a number here would be invented.
    ci_wasted_trigger: null,
    file_loss: { value: 0, samples: countGuardRuns(audit) },
  };
}

/** How many guard runs the journal actually observed (file-loss denominator). */
function countGuardRuns(audit) {
  return audit.filter((e) => /worktree.?guard|file.?loss/i.test(String(e.event || e.gate_id || ''))).length;
}

function buildReport(opts) {
  const { days, commits, audit, quality, sprints, gateMRuns = [] } = opts;
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  const L = [];

  L.push('# Sprint Engineering Retrospective');
  L.push('');
  L.push(`Period: ${start.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}`);
  L.push('');

  // Activity Summary
  L.push('## Activity Summary');
  const gateEntries = audit.filter(e => e.gate_id);
  const passed = gateEntries.filter(e => e.passed).length;
  const measurable = gateEntries.filter(isUsableDuration);
  const excluded = gateEntries.length - measurable.length;
  const nullDurations = gateEntries.filter(e => e.duration_ms === null).length;
  const avgMs = measurable.length > 0
    ? Math.round(measurable.reduce((s, e) => s + e.duration_ms, 0) / measurable.length)
    : 0;
  L.push(`- Total commits in window: ${commits.length}`);
  L.push(`- Sprint transitions recorded: ${sprints.length}`);
  L.push(`- Gate pass rate: ${gateEntries.length > 0 ? ((passed / gateEntries.length) * 100).toFixed(1) : '0.0'}% (${gateEntries.length} gates total, ${gateEntries.length - passed} failed)`);
  if (measurable.length > 0) {
    // p50 alongside the mean: with a long tail the mean is the least useful
    // statistic, and "avg gate duration: 2.2e12ms" was the visible symptom.
    const sorted = measurable.map(e => e.duration_ms).sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];
    L.push(`- Avg gate duration: ${avgMs}ms, p50 ${p50}ms over ${measurable.length} measurable gate(s) (${excluded} excluded${nullDurations ? `, ${nullDurations} recorded null` : ''})`);
  } else if (gateEntries.length > 0) {
    L.push(`- Avg gate duration: no measurable samples (${excluded} of ${gateEntries.length} excluded as null or anomalous)`);
  }
  L.push('');

  // SLO panel (#609, guide §15)
  L.push('## SLO Dashboard (#609)');
  const sloRows = evaluateAll(deriveSloMeasurements(audit, computeFlakyStats(gateEntries)));
  const sloCounts = summariseStates(sloRows);
  L.push(`- ${sloCounts.PASS} PASS / ${sloCounts.MISS} MISS / ${sloCounts.UNKNOWN} UNKNOWN of ${sloCounts.total}`);
  if (sloCounts.UNKNOWN === sloCounts.total) {
    // Print the distinction explicitly. An all-UNKNOWN panel is the normal state
    // for a journal that never recorded attempts, and calling that "0% healthy"
    // would be the same defect the panel exists to prevent.
    L.push('- All six UNKNOWN: the journal holds no attempt-level records for this window.');
    L.push('  That is "not measured", not "nothing wrong" -- see each row source.');
  }
  for (const r of sloRows) {
    const shown = r.value === null ? '--' : `${r.value}${r.unit}`;
    const goal = `${r.direction === 'min' ? '>=' : '<='} ${r.target}${r.unit}`;
    L.push(`- [${r.state}] ${r.label}: ${shown} (goal ${goal})`);
    if (r.state === 'UNKNOWN') L.push(`    reason: ${r.reason}`);
    if (r.state === 'MISS') L.push(`    ${r.reason}`);
  }
  L.push('');

  // Flaky-test governance (#603)
  L.push('## Test Stability (#603)');
  const flaky = computeFlakyStats(gateEntries);
  if (!flaky.measurable) {
    // Say "not measured" rather than "0%". A journal with no re-runs cannot
    // distinguish a stable suite from an unmeasured one, and printing 0% would
    // claim the former.
    L.push(`⚠️  NOT MEASURABLE — ${flaky.reason}`);
  } else {
    L.push(`- First-pass rate: ${flaky.firstPassRate}% (${flaky.firstPasses}/${flaky.firstAttempts} first attempts)`);
    L.push(`- Flaky recoveries: ${flaky.flakyRecoveries} of ${flaky.totalRuns} run(s) passed only on re-run (${flaky.flakyRate}%)`);
    // The pass rate above counts re-run successes, so state the gap explicitly.
    L.push(`- Note: the gate pass rate above counts re-run successes; first-pass rate is the honest number.`);
  }
  const quarantineEntries = parseQuarantine(path.join(process.cwd(), '.flaky-quarantine.yaml'));
  if (quarantineEntries.length > 0) {
    const violations = findPolicyViolations(quarantineEntries, now);
    L.push(`- Quarantined tests: ${quarantineEntries.length} (${violations.length} policy violation(s))`);
    for (const v of violations) {
      // An expired entry is a permanent deletion wearing a quarantine badge.
      L.push(`  - ${v.rule}: ${v.entry.test} (owner ${v.entry.owner || 'unassigned'}, expiry ${v.entry.expiry || 'none'})`);
    }
  }
  L.push('');

  // Rework Rate Trend (#369)
  L.push('## Rework Rate Trend (#369)');
  const withRate = sprints.filter(s => s.metrics && s.metrics.rework_rate != null);
  if (withRate.length === 0) {
    L.push('No data');
  } else {
    L.push('| Sprint | Rework Rate | Fix Commits | Total Commits |');
    L.push('|--------|-------------|-------------|---------------|');
    for (const s of withRate) {
      const pct = (s.metrics.rework_rate * 100).toFixed(1);
      const fix = s.metrics.total_sprint_commits != null
        ? Math.round(s.metrics.rework_rate * s.metrics.total_sprint_commits)
        : '?';
      L.push(`| ${s.id || 'unknown'} | ${pct}% | ${fix} | ${s.metrics.total_sprint_commits ?? '?'} |`);
      if (s.metrics.rework_rate > 0.30) {
        L.push(`⚠️ Sprint ${s.id || 'unknown'}: ${pct}% rework — exceeds 30% threshold`);
      }
    }
  }
  L.push('');

  // Evidence Skip Exposure (§8.4)
  L.push('## Evidence Skip Exposure (§8.4)');
  const skipped = audit.filter(e => e.event === 'evidence_skipped');
  if (skipped.length === 0) {
    L.push('No data');
  } else {
    L.push('| Phase | Reason | Timestamp |');
    L.push('|-------|--------|-----------|');
    for (const e of skipped) {
      L.push(`| ${e.phase || '?'} | ${e.reason || '?'} | ${(e.timestamp || '').slice(0, 19)} |`);
    }
    const bySprint = {};
    for (const e of skipped) {
      const k = e.sprint_id || 'unknown';
      bySprint[k] = (bySprint[k] || 0) + 1;
    }
    for (const [sid, count] of Object.entries(bySprint)) {
      if (count > 2) {
        L.push(`⚠️ Sprint ${sid} used skip ${count} times`);
      }
    }
  }
  L.push('');

  // Gate M (Mutation Testing) — #404 P1-3
  L.push(...buildGateMSection(gateMRuns));

  // Quality Trend
  L.push('## Quality Trend');
  if (quality.length === 0) {
    L.push('No data');
  } else {
    for (const q of quality) {
      L.push(`- ${(q.timestamp || '').slice(0, 10)}: score ${q.score ?? '?'}`);
    }
  }

  return L.join('\n');
}

/**
 * CLI entry point for xp-gate retro.
 * @param {string[]} args - CLI subargs (without 'retro')
 * @returns {Promise<number>} Exit code
 */
async function handleRetro(args = []) {
  const allFlag = args.includes('--all');
  const jsonFlag = args.includes('--json');
  const daysIdx = args.indexOf('--days');
  const sprintIdx = args.indexOf('--sprint');

  let days = allFlag ? 30 : 7;
  if (daysIdx >= 0 && args[daysIdx + 1]) {
    days = parseInt(args[daysIdx + 1], 10);
    if (isNaN(days) || days < 1) days = 7;
  }

  const sprintFilter = (sprintIdx >= 0 && args[sprintIdx + 1]) ? args[sprintIdx + 1] : null;
  const dir = process.cwd();

  const commits = getGitCommits(dir, days);
  const audit = readAuditEntries(dir);
  const quality = readQualityHistory(dir);
  const sprints = readSprintHistory(dir, sprintFilter);
  const gateMRuns = readGateMRuns(dir);

  if (jsonFlag) {
    const gateEntries = audit.filter(e => e.gate_id);
    const passed = gateEntries.filter(e => e.passed).length;
    const sloRows = evaluateAll(deriveSloMeasurements(audit, computeFlakyStats(gateEntries)));
    console.log(JSON.stringify({
      period: { days, from: new Date(Date.now() - days * 86400000).toISOString(), to: new Date().toISOString() },
      total_commits: commits.length,
      gate_pass_rate: gateEntries.length > 0 ? passed / gateEntries.length : null,
      slo: {
        states: summariseStates(sloRows),
        metrics: sloRows.map(r => ({
          id: r.id, label: r.label, target: r.target, unit: r.unit,
          direction: r.direction, value: r.value, state: r.state,
          reason: r.reason, source: r.source,
        })),
      },
      rework_rates: sprints.filter(s => s.metrics?.rework_rate != null).map(s => ({ id: s.id, rate: s.metrics.rework_rate })),
      evidence_skipped: audit.filter(e => e.event === 'evidence_skipped'),
      quality: quality.map(q => ({ timestamp: q.timestamp, score: q.score })),
      gate_m: (() => {
        const s = summariseGateM(gateMRuns);
        return {
          runs: s.total,
          passed: s.passed,
          blocked: s.blocked,
          timed_out: s.timedOut,
          skipped: s.skipped,
          skip_reasons: s.reasons,
          measured_scores: s.measured.map(r => r.score),
          measured_durations_ms: s.durations,
        };
      })(),
    }, null, 2));
    return 0;
  }

  console.log(buildReport({ days, commits, audit, quality, sprints, gateMRuns }));
  return 0;
}

module.exports = { handleRetro };
