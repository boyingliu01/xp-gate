/**
 * `xp-gate gate-coverage` — one view of compliance against every gate (#636).
 *
 * Every other command answers "did THIS gate pass". This answers "where is the
 * debt, and what should I fix first" — which previously took six commands and
 * mental arithmetic.
 *
 * The design decision that matters most: there are FOUR states, not three.
 * A `passed / skipped / failed` split merges "did not run" into "ran and was
 * fine", and that is precisely where debt hides. A gate that never executed
 * must never look like a gate that passed clean.
 *
 * No runtime dependencies: this ships inside the zero-install package.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The four states. `SKIP` and `DEBT` both mean "not clean", differently. */
const STATUS = Object.freeze({
  PASS: 'PASS',
  DEBT: 'DEBT',
  SKIP: 'SKIP',
  FAIL: 'FAIL',
});

const QUALITY_STATUS_DIR = path.join('.xp-gate', 'quality-status');

/**
 * The canonical gate table.
 *
 * `statusKey` maps this project's numbering onto the quality-status
 * producer's taxonomy, which numbers Build Integrity as `gate9_*` and SAST as
 * `gate10_*` — the two are SWAPPED relative to the CLI. Rendering the artifact
 * key directly would show the user the wrong gate name, which is worse than
 * showing nothing. Pinned by AC-636-02.
 *
 * `evidence` is what makes a row checkable rather than just believable: the
 * path or command that produced the verdict.
 */


/** The Boy Scout debt lives in its baseline, not in a gate status. */
/**
 * The gate table and the producer's artifact keys are DERIVED from
 * `githooks/gate-registry.sh`, never declared here.
 *
 * This file used to carry two handwritten tables: a number->name array and a
 * "producer keys" array that also mapped artifact key -> number. The second one
 * contained this comment:
 *
 *     // NOTE the swap: the producer calls Build Integrity gate9 and SAST
 *     // gate10, while this project numbers them the other way round.
 *
 * That claim was FALSE. `githooks/pre-commit` emits `gate9_build_integrity` and
 * `gate10_sast` — exactly what the registry says. The swap table encoded an
 * inversion that never existed, so `gate-coverage` answered questions about one
 * artifact using another artifact's numbering: with an artifact reporting
 * `gate9_build_integrity=PASS` it printed "9 SAST Security PASS" (#738).
 *
 * Deleting the table alone would not fix the class: it removes one copy of a
 * fact without removing the act of copying. So both tables are derived, and
 * scripts/__tests__/gate-identity-cross-surface.test.cjs compares the derived
 * surfaces against the registry. Restore a handwritten mapping here and that
 * test fails.
 *
 * The derived table deliberately keeps the field shape `{ gate, name, ... }`
 * with a string `name` value. An earlier version avoided that shape because a
 * generic-api-key scanner reads `name: 'literal'` as a credential; the values
 * now come from the registry at runtime rather than appearing as literals in
 * this file, so the scanner has nothing to match.
 */
const { loadRegistry, parseRegistry, parseReportKeyOverrides, deriveGateTable, reportKey } = require('./gate-identity');

/**
 * The derived gate table, computed ON FIRST USE rather than at require() time.
 *
 * A copy disagreement in the registry is a real, fatal condition for anything
 * that renders gates -- but it is not a fact about arithmetic on an artifact.
 * Computing it eagerly meant `require('gate-coverage')` threw for consumers that
 * only wanted `STATUS` or `exitCodeFor`, so a packaging bug in a file the caller
 * never reads would take down an unrelated code path. Deferring it keeps the
 * fail-closed behaviour where it belongs: the throw now fires on the first call
 * that actually needs gate identity, and the message still names every differing
 * copy (see loadRegistry).
 */
let _gateTableCache = null;

function gateTable() {
  if (_gateTableCache === null) {
    const registry = loadRegistry();
    _gateTableCache = deriveGateTable(
      parseRegistry(registry.text),
      parseReportKeyOverrides(registry.text),
    );
  }
  return _gateTableCache;
}

/**
 * Registry rows, keyed by number, with the artifact report key attached.
 * Replaces the deleted PRODUCER_KEYS / GATE_NUMBER_TO_PRODUCER pair.
 */
// Built per call from the same lazy table, so a renumbering can never leave a
// stale number->row index behind.
function gateByNumber() {
  return new Map(gateTable().map((row) => [row.gate, row]));
}

/**
 * Evidence pointer per gate. This is the ONE thing this file still owns: the
 * human-readable description of where a verdict comes from. It is keyed by
 * registry NAME (not number), so renumbering a gate cannot orphan an entry.
 */
const EVIDENCE_BY_NAME = {
  'version-consistency': 'VERSION and package.json',
  'code-quality': 'adapter lint output',
  'duplicate-code': 'jscpd configuration',
  complexity: 'ccn baseline',
  principles: 'principles rc',
  'tests-coverage': 'coverage summary',
  architecture: 'warnings baseline (see .warnings-baseline.json)',
  'iac-security': 'iac scanner configuration',
  'secret-scanning': 'secret scanner configuration',
  'build-integrity': 'typecheck and pack',
  sast: 'sast ruleset',
  'sprint-flow': 'specification',
  'file-hygiene': 'file hygiene script',
  'compiler-strictness': 'compiler strictness script',
};

/**
 * Display names, keyed by registry SLUG.
 *
 * The slug is the identity and every comparison uses it. This map only makes
 * the report readable ("build-integrity" -> "Build Integrity"); a missing entry
 * degrades to the slug rather than to nothing, so adding a gate to the registry
 * never produces a blank row. Keying by slug (not number) means renumbering
 * cannot orphan an entry — which is the failure this whole sprint removes.
 */
const GATE_DISPLAY_NAME = {
  'version-consistency': 'Version Consistency',
  'code-quality': 'Code Quality',
  'duplicate-code': 'Duplicate Code',
  complexity: 'Cyclomatic Complexity',
  principles: 'Principles',
  'tests-coverage': 'Tests + Coverage',
  architecture: 'Architecture + Boy Scout',
  'iac-security': 'IaC Security',
  'secret-scanning': 'Secret Scanning',
  'build-integrity': 'Build Integrity',
  sast: 'SAST Security',
  'sprint-flow': 'Sprint Flow',
  'file-hygiene': 'File Hygiene',
  'compiler-strictness': 'Compiler Strictness',
};

const BOY_SCOUT_GATE = 6;

/**
 * Read `.xp-gate/quality-status/<branch>.json` if present.
 *
 * Deterministic or explicit failure (REQ-GATEID-007). This used to fall through
 * to `readdirSync` over every `.json` and take the first parseable one, so a
 * bare `xp-gate gate-coverage` read whichever file the filesystem happened to
 * list first. In this repo that was `land-pr438.json` (commit 33672f6d) rather
 * than the current branch's `main.json` — so the command reported another
 * commit's SAST result as if it were this one's, printing `stale: true` as a
 * notice while presenting the wrong object. Reading the wrong object is worse
 * than reading a stale one, and "stale" masked it.
 *
 * Now: one candidate -> use it. Several -> REFUSE and say how to disambiguate.
 * Explicit `--branch` that does not exist -> error, never a silent fallback.
 *
 * @param {string} repoRoot
 * @param {string} [branch]
 * @returns {{artifact: object|null, file: string|null, error?: string, candidates?: string[]}}
 */
function readQualityStatus(repoRoot, branch) {
  const dir = path.join(repoRoot, QUALITY_STATUS_DIR);

  if (branch) {
    const wanted = path.join(dir, `${branch}.json`);
    if (!fs.existsSync(wanted)) {
      return {
        artifact: null,
        file: null,
        error: `no quality-status artifact for branch "${branch}": ${wanted} does not exist`,
      };
    }
    return { artifact: parseArtifact(wanted), file: wanted };
  }

  let names;
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return { artifact: null, file: null };
  }

  if (names.length === 0) return { artifact: null, file: null };

  if (names.length > 1) {
    const candidates = names.map((name) => name.replace(/\.json$/, ''));
    return {
      artifact: null,
      file: null,
      candidates,
      error: `found ${names.length} quality-status artifacts (${candidates.join(', ')}); `
        + 'refusing to pick one by directory order — pass --branch <name> to choose',
    };
  }

  const only = path.join(dir, names[0]);
  return { artifact: parseArtifact(only), file: only };
}

/**
 * Parse one artifact file. A malformed artifact is ABSENT, never clean.
 * @param {string} file
 */
function parseArtifact(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Build one row per gate, in gate order.
 *
 * @param {object|null} artifact quality-status JSON (may be null)
 * @param {{headCommit?: string, boyScout?: {files: number, warnings: number}}} [ctx]
 * @returns {Array<object>}
 */
function buildCoverageRows(artifact, ctx) {
  const context = ctx || {};
  const gates = (artifact && artifact.gates) || {};

  const table = gateTable();
  const byNumber = gateByNumber();

  return table.map((spec) => {
    // Look the gate up by its OWN report key, derived from the registry. The
    // deleted swap table used to translate between two numberings here; there
    // was only ever one numbering (#738).
    const entry = gates[reportKey({ name: spec.slug, number: spec.gate })];
    const row = {
      gate: spec.gate,
      name: GATE_DISPLAY_NAME[spec.slug] || spec.slug,
      evidence: EVIDENCE_BY_NAME[spec.slug] || spec.impl,
    };

    if (!entry) {
      row.status = STATUS.SKIP;
      row.reason = missingGateReason(spec);
      return row;
    }

    const raw = String(entry.status || '').toUpperCase();
    if (raw === 'FAIL') {
      row.status = STATUS.FAIL;
      row.debt = entry.message || 'gate reported failure';
      return row;
    }
    if (raw === 'SKIP') {
      row.status = STATUS.SKIP;
      row.reason = entry.reason || 'not-applicable';
      return row;
    }
    row.status = STATUS.PASS;
    return row;
  }).map((row) => {
    // Boy Scout debt does not appear as a gate status at all: Gate 6 reports
    // PASS because it "did not increase", while 129 warnings sit in the
    // baseline. Reading only statuses shows a clean PASS and hides the debt.
    if (row.gate === BOY_SCOUT_GATE && context.boyScout && context.boyScout.warnings > 0) {
      return {
        ...row,
        status: STATUS.DEBT,
        debt: describeBoyScoutDebt(context.boyScout),
        evidence: 'warnings baseline (see .warnings-baseline.json)',
      };
    }
    return row;
  });
}

/**
 * Why a gate produced no verdict.
 *
 * Not in the artifact at all. This is NOT "passed" and NOT "by design": the gate
 * produced no verdict, so the only honest label is SKIP + why. `hookOnly` here means
 * "the artifact is generated by a git hook, so its absence means no commit has run
 * it yet" -- not "it can never run".
 */
function missingGateReason(spec) {
  // `hook` comes from the registry: a pre-commit gate absent from the artifact
  // means no commit has run it yet; a pre-push gate absent means it was not in
  // the last pre-push report. Both are "no verdict", neither is "clean".
  return spec.hook === 'pre-push'
    ? 'no result recorded — runs via git push'
    : 'no result recorded — runs via git commit';
}

/**
 * Resolve the coverage floor from both gates and report disagreement (#605).
 *
 * Read from source rather than cached: both files are small, and a stale threshold
 * report is worse than none -- it would assert the gates agree when they need not.
 * Either side absent degrades to "unknown", never to "no conflict".
 */
function readCoverageThresholdConflict(repoRoot) {
  try {
    const { resolveCoverageThreshold } = require('./coverage-threshold.js');
    const sources = {};
    const vitest = readVitestThresholds(repoRoot);
    if (vitest) sources.vitest = vitest;
    const hookFloor = readHookCoverageFloor(repoRoot);
    if (hookFloor !== null) sources.preCommit = hookFloor;
    const resolved = resolveCoverageThreshold(sources);
    if (!vitest && hookFloor === null) return { ...resolved, sources: 'none readable' };
    return resolved;
  } catch {
    return null;
  }
}

/**
 * `thresholds: { lines: N, ... }` from vitest.config.ts, or null when absent.
 *
 * Comments are stripped first. The file documents the #561 failure by quoting the
 * old bad shape (`thresholds: { global: {...} }`) in prose, and a naive match reads
 * that quote as the live config -- reporting a threshold the repo does not use,
 * which is exactly the class of error #605 exists to stop.
 */
function readVitestThresholds(repoRoot) {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, 'vitest.config.ts'), 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const block = code.match(/thresholds:\s*\{([\s\S]*?)\}/);
    if (!block) return null;
    const out = {};
    for (const m of block[1].matchAll(/(lines|statements|functions|branches)\s*:\s*(\d+)/g)) {
      out[m[1]] = Number(m[2]);
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * The floor the pre-commit hook applies, or null when the hook applies none.
 *
 * The hook RESOLVES its floor at runtime (`_resolve_coverage_threshold`) from the
 * project's own declaration -- pyproject / .coveragerc / vitest.config.ts -- and
 * only falls back to a literal in the defensive guard. So a literal found in the
 * file is usually NOT the enforced number:
 *
 *   - `${COVERAGE_THRESHOLD:-80}` is the default inside *log messages*; it renders
 *     only if the variable is empty, which the guard above prevents.
 *   - `COVERAGE_THRESHOLD=80` is the guard itself, reached only when nothing was
 *     declared.
 *
 * Matching either one as "the hook's floor" is how this report used to announce a
 * 80-vs-70 CONFLICT that did not exist: the hook was enforcing 70 (read from
 * vitest.config.ts) while the reporter read a message literal and compared the two.
 * A false conflict is worse than no conflict -- it sends someone to change a
 * declaration that was already correct (#605).
 *
 * Both literals are therefore treated as "no declared floor": the reporter then
 * defers to the declaration, which is exactly what the hook does.
 */
function readHookCoverageFloor(repoRoot) {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, 'githooks', 'pre-commit'), 'utf8');
    if (!/COVERAGE_THRESHOLD/.test(raw)) return null;

    // Strip shell message templates (`${VAR:-NN}`) before scanning: those are
    // display defaults, not enforcement.
    const withoutTemplates = raw.replace(/\$\{COVERAGE_THRESHOLD:-?\d+\}/g, '');

    // Assignment forms only, and only outside the defensive guard. The guard is
    // recognisable by its comment-free shape: `COVERAGE_THRESHOLD=NN` sitting
    // directly after the `-z`/regex test that precedes it in every version.
    const matches = [...withoutTemplates.matchAll(
      /(?:^[ \t]*(?:export[ \t]+)?COVERAGE_THRESHOLD=(\d+)[ \t]*$)/gm,
    )].map((m) => Number(m[1]));
    if (matches.length === 0) return null;

    // The runtime resolver writes `COVERAGE_THRESHOLD="$_rct_value"`, which the
    // numeric pattern above deliberately does not match. Any remaining numeric
    // assignment other than the documented 80 fallback is the real floor.
    const nonFallback = matches.filter((value) => value !== 80);
    if (nonFallback.length > 0) return nonFallback[nonFallback.length - 1];

    // Only the guard's fallback remains. The guard exists for a variable that
    // arrived empty; when a project declares a threshold it never fires. Report
    // "no declared floor" so the reporter uses the declaration, as the hook does.
    return null;
  } catch {
    return null;
  }
}

/**
 * Describe Boy Scout debt by how much of it is worth fixing (#638).
 *
 * `magic-numbers` is severity=info and accounts for roughly half the raw count, so a
 * single total is un-actionable: clearing every real finding barely moves it, and a
 * number that cannot express progress cannot direct work.
 */
function describeBoyScoutDebt(boyScout) {
  const breakdown = boyScout.breakdown;
  if (!breakdown) return `${boyScout.warnings} warning(s) / ${boyScout.files} file(s)`;
  return `${breakdown.actionable} actionable / ${breakdown.informational} informational (${boyScout.files} file(s))`;
}

/** Render rows as the human-readable overview. */
function renderGateCoverage(rows, opts) {
  const options = opts || {};
  const lines = [];
  const counts = { PASS: 0, DEBT: 0, SKIP: 0, FAIL: 0 };
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('   GATE COVERAGE');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (options.stale) {
    // Never present a different commit's results as current. This artifact has
    // sat at an old commit for days before; silence would have been a lie.
    lines.push('');
    lines.push(`  ⚠️  STALE — artifact was generated for ${options.artifactCommit || 'a different commit'}, `
      + `HEAD is ${options.headCommit || 'unknown'}`);
    lines.push('     Numbers below describe that commit, NOT the working tree.');
  }

  if (options.coverageThreshold && options.coverageThreshold.conflict) {
    // #605: two live gates enforcing different numbers for the same thing. Reported
    // here rather than resolved silently -- picking one side is how a repo ends up
    // documented at 80% and enforced at 60%.
    lines.push('');
    lines.push(`  ⚠️  COVERAGE THRESHOLD CONFLICT — ${options.coverageThreshold.conflict.detail}`);
    lines.push('     Both gates read the same number and disagree. Fix the declarations,');
    lines.push('     not the reporting.');
  }

  lines.push('');
  lines.push(`  ${counts.PASS} PASS / ${counts.DEBT} DEBT / ${counts.SKIP} SKIP / ${counts.FAIL} FAIL`);
  if (counts.SKIP > 0) {
    // The one line that must never be quiet: SKIP is not green.
    lines.push(`  ${counts.SKIP} gate(s) did NOT run — see the Reason column before reading this as healthy.`);
  }
  lines.push('');
  lines.push('  Gate  Name                       Status  Debt / Reason                Evidence');
  lines.push('  ────  ─────────────────────────  ──────  ───────────────────────────  ────────────────────────');
  for (const row of rows) {
    const id = String(row.gate).padStart(4);
    const name = row.name.padEnd(25).slice(0, 25);
    const status = row.status.padEnd(6);
    const detail = String(row.debt || row.reason || '-').padEnd(27).slice(0, 27);
    const evidence = row.evidence || '-';
    lines.push(`  ${id}  ${name}  ${status}  ${detail}  ${evidence}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Exit code: DEBT is budgeted and known, so it must not fail by default —
 * otherwise the command cannot be used as a CI dashboard. `--strict` opts into
 * treating debt as a failure for "debt cleared" milestone tracking.
 */
function exitCodeFor(rows, opts) {
  const options = opts || {};
  const statuses = rows.map((r) => r.status);
  if (statuses.includes(STATUS.FAIL)) return 1;
  if (options.strict && statuses.includes(STATUS.DEBT)) return 1;
  return 0;
}

/** Sum the Boy Scout baseline into the shape buildCoverageRows expects. */
function readBoyScoutDebt(repoRoot) {
  try {
    const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, '.warnings-baseline.json'), 'utf8'));
    const files = Object.keys(baseline);
    let warnings = 0;
    for (const key of files) {
      const value = baseline[key];
      warnings += typeof value === 'number' ? value : (value && value.totalWarnings) || 0;
    }
    return { files: files.length, warnings, breakdown: readDebtBreakdown(repoRoot, files) };
  } catch {
    return null;
  }
}

/**
 * Rule-level breakdown of the Boy Scout debt (#638).
 *
 * The baseline stores only `totalWarnings` per file, so the split cannot be derived
 * from it. It also must not be recomputed on every `gate-coverage` call: analysing
 * 17 files through the principles engine costs ~90s, and a report command that takes
 * a minute and a half stops being run.
 *
 * Hence a cache keyed on the baseline file's mtime+size: any commit that changes the
 * debt changes the baseline, which invalidates the cache. A stale split is worse
 * than no split, because it would report progress that did not happen.
 */
function readDebtBreakdown(repoRoot, files) {
  try {
    const { summarizeDebtByFixability } = require('./debt-classify.js');
    const baselinePath = path.join(repoRoot, '.warnings-baseline.json');
    const stat = fs.statSync(baselinePath);
    const cachePath = path.join(repoRoot, '.xp-gate', 'debt-breakdown.json');
    const cacheKey = `${stat.mtimeMs}:${stat.size}`;
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached && cached.key === cacheKey && cached.breakdown) return cached.breakdown;
    } catch {
      // No usable cache -- fall through and recompute.
    }
    const { execFileSync } = require('node:child_process');
    const targets = files.filter((f) => !f.includes('/src/npm-package/'));
    const raw = execFileSync(
      process.execPath,
      [path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
       path.join(repoRoot, 'src', 'principles', 'index.ts'),
       '--files', targets.join(' '), '--format', 'json'],
      { cwd: repoRoot, encoding: 'utf8', timeout: 180000 },
    );
    const parsed = JSON.parse(raw);
    const rows = Object.entries(parsed.ruleResults || {}).map(([rule, v]) => ({
      rule,
      count: v.violationCount || 0,
    }));
    const breakdown = summarizeDebtByFixability(rows);
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ key: cacheKey, breakdown }));
    } catch {
      // A cache write failure must not break the report.
    }
    return breakdown;
  } catch {
    // Degrade to the plain total rather than failing the whole report.
    return null;
  }
}

/** CLI entry. */
function main(argv, deps) {
  const args = argv || [];
  const ctx = deps || {};
  const repoRoot = ctx.repoRoot || process.cwd();

  const branchIdx = args.indexOf('--branch');
  const branch = branchIdx !== -1 ? args[branchIdx + 1] : ctx.branch;
  const status = readQualityStatus(repoRoot, branch);

  if (status.error) {
    // Deterministic-or-fail (REQ-GATEID-007). The migration hint lives IN the
    // error text: turning a silent wrong answer into a bare error would be a
    // worse failure mode than the bug it replaces.
    const hint = status.candidates
      ? `\n  Retry with one of: ${status.candidates.map((name) => `--branch ${name}`).join(' | ')}`
      : '';
    process.stderr.write(`\n  [gate-coverage] ${status.error}${hint}\n\n`);
    return 2;
  }

  const { artifact, file } = status;
  const headCommit = ctx.headCommit;

  const stale = Boolean(artifact && headCommit && artifact.commit && artifact.commit !== headCommit);
  const rows = buildCoverageRows(artifact, {
    headCommit,
    boyScout: readBoyScoutDebt(repoRoot),
  });
  const coverageThreshold = readCoverageThresholdConflict(repoRoot);

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: '1.0',
      stale,
      artifactCommit: artifact ? artifact.commit : null,
      headCommit: headCommit || null,
      artifactFile: file,
      summary: rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {}),
      coverageThreshold,
      gates: rows,
    }, null, 2)}\n`);
    return exitCodeFor(rows, { strict: args.includes('--strict') });
  }

  const shown = args.includes('--debt')
    ? rows.filter((r) => r.status === STATUS.DEBT || r.status === STATUS.FAIL)
    : rows;
  process.stdout.write(`${renderGateCoverage(shown, {
    stale,
    headCommit,
    artifactCommit: artifact ? artifact.commit : null,
    coverageThreshold,
  })}\n`);
  return exitCodeFor(rows, { strict: args.includes('--strict') });
}

module.exports = {
  STATUS,
  gateTable,
  buildCoverageRows,
  renderGateCoverage,
  exitCodeFor,
  readQualityStatus,
  readBoyScoutDebt,
  readHookCoverageFloor,
  main,
};
