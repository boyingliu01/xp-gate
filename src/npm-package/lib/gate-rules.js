/**
 * Collect the gate thresholds that actually block a commit, from the files that
 * define them (#652).
 *
 * Why generated rather than hand-written: BUILD-phase docs used to say "there are
 * gates 0-11" without saying what the numbers are. The numbers live in
 * `.principlesrc`, `jscpd.conf.json`, `.ccn-baseline.json` and the hook itself. A
 * hand-copied table is correct on the day it is written and wrong on the day
 * someone tunes a threshold — and a self-check list that lies is worse than none,
 * because it teaches the wrong rule and then contradicts it at commit time.
 *
 * Every rule therefore carries an `evidence` pointer, so "the limit is 50" can be
 * checked or argued with instead of being indistinguishable from a guess.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Read and parse a JSON file, or null when absent/unreadable. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Normalise severity spellings.
 *
 * The config files and the hook do not agree: `.principlesrc` says `warning`,
 * Gate 3's boundary is `warn`, and both mean the same thing. Carrying two spellings
 * into one list would make it look like two different severities exist.
 */
function normaliseSeverity(value) {
  if (value === 'warning') return 'warn';
  if (value === 'block' || value === 'warn' || value === 'info') return value;
  return 'warn';
}

/** Flatten `.principlesrc` rules into entries with source + evidence. */
function principlesRules(cwd) {
  const file = path.join(cwd, '.principlesrc');
  const cfg = readJson(file);
  if (!cfg || !cfg.rules) return [];
  const out = [];
  for (const group of Object.keys(cfg.rules)) {
    for (const [name, rule] of Object.entries(cfg.rules[group] || {})) {
      out.push({
        id: `${group}.${name}`,
        source: 'principles',
        severity: normaliseSeverity(rule.severity),
        // Not every rule is threshold-shaped (e.g. unused-imports); report the
        // one that exists rather than inventing a 0.
        threshold: typeof rule.threshold === 'number' ? rule.threshold : null,
        evidence: '.principlesrc',
      });
    }
  }
  return out;
}

/**
 * Gate 2's duplicate-code rule.
 *
 * `githooks/pre-commit` prints "jscpd found duplicated code (warning, not blocking
 * by default)" -- this gate reports, it does not block. The BUILD-phase doc used to
 * claim "jscpd similarity >5% BLOCK", which sent people to refactor for a verdict
 * that never fires. A generated list must record what the hook does, not what the
 * old prose said.
 */
function jscpdRules(cwd) {
  const cfg = readJson(path.join(cwd, 'jscpd.conf.json'));
  // jscpd itself has no similarity threshold in this project's config and the hook
  // never compares a percentage. Reporting null says "no limit declared" instead of
  // inventing a number the hook does not enforce.
  const threshold = cfg && typeof cfg.threshold === 'number' ? cfg.threshold : null;
  return [
    {
      id: 'duplication.jscpd',
      source: 'jscpd',
      severity: 'info',
      threshold,
      evidence: 'githooks/pre-commit (Gate 2, advisory)',
    },
  ];
}

/** Gate 3 warn/block boundaries, which the hook itself owns. */
function ccnRules(cwd) {
  return [
    { id: 'ccn.warn', source: 'ccn', severity: 'warn', threshold: 5, evidence: 'githooks/pre-commit (Gate 3)' },
    { id: 'ccn.block', source: 'ccn', severity: 'block', threshold: 10, evidence: 'githooks/pre-commit (Gate 3)' },
  ];
}

/** Boy Scout's structural limits, read from wherever they are configured. */
function boyScoutRules(cwd) {
  const out = [
    {
      id: 'boy-scout.new-file',
      source: 'boy-scout',
      severity: 'block',
      threshold: 0,
      evidence: 'src/principles/boy-scout.ts',
    },
  ];
  // The per-function line and nesting limits are principles rules; when
  // .principlesrc exists they are already listed by principlesRules, so only add
  // here when it does not (so the BUILD list never silently loses them).
  const cfg = readJson(path.join(cwd, '.principlesrc'));
  if (!cfg || !cfg.rules || !cfg.rules['clean-code']) {
    out.push(
      { id: 'clean-code.long-function', source: 'boy-scout', severity: 'warn', threshold: 50, evidence: 'defaults' },
      { id: 'clean-code.deep-nesting', source: 'boy-scout', severity: 'warn', threshold: 4, evidence: 'defaults' },
    );
  }
  return out;
}

/**
 * Collect every rule that can block or warn a commit.
 *
 * @param {{cwd?: string}} opts
 * @returns {Array<{id: string, source: string, severity: string, threshold: number|null, evidence: string}>}
 */
function collectGateRules(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const rules = [...principlesRules(cwd), ...jscpdRules(cwd), ...ccnRules(cwd), ...boyScoutRules(cwd)];
  // Stable order: blocking first, then warn/info, so a reader stops at what hurts.
  const rank = { block: 0, warn: 1, info: 2 };
  return rules.sort(
    (a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || a.id.localeCompare(b.id),
  );
}

/** Render the checklist as markdown with an evidence column. */
function renderGateRules(rules) {
  const lines = ['| Rule | Severity | Limit | Evidence |', '|---|---|---|---|'];
  for (const rule of rules) {
    lines.push(
      `| \`${rule.id}\` | ${rule.severity} | ${rule.threshold === null ? '—' : rule.threshold} | \`${rule.evidence}\` |`,
    );
  }
  return lines.join('\n');
}

module.exports = { collectGateRules, renderGateRules };
