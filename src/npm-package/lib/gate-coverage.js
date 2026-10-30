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
 * The quality-status producer's own keys, in ITS numbering.
 *
 * Kept as an array of pairs rather than an object literal so the table below
 * stays free of `name: 'literal'` shapes -- a generic-api-key scanner reads
 * those as credentials, and teaching the secret gate to ignore this file would
 * be a worse trade than reshaping the data.
 */
const PRODUCER_KEYS = [
  ['gate0_version_consistency', 0],
  ['gate1_static_analysis', 1],
  ['gate2_dup_code', 2],
  ['gate3_complexity', 3],
  ['gate4_principles', 4],
  ['gate5_tests', 5],
  ['gate6_arch_boyscout', 6],
  ['gate7_iac_security', 7],
  ['gate8_secret_scanning', 8],
  // NOTE the swap: the producer calls Build Integrity gate9 and SAST gate10,
  // while this project numbers them the other way round.
  ['gate10_sast', 9],
  ['gate9_build_integrity', 10],
  ['gate11_sprint_flow', 11],
  ['gate12_file_hygiene', 12],
  ['gate13_compiler_strictness', 13],
];

/** Producer key -> this project's gate number. */
const PRODUCER_GATE_NUMBER = new Map(PRODUCER_KEYS);

/** This project's gate number -> producer key. */
const GATE_NUMBER_TO_PRODUCER = new Map(PRODUCER_KEYS.map(([k, n]) => [n, k]));

/**
 * The canonical gate table: number, name, whether the CLI can run it, and the
 * artifact that decides its verdict.
 *
 * Gate names deliberately match `xp-gate gate-list`; the producer's differing
 * numbering is absorbed by PRODUCER_KEYS above.
 */
const GATE_TABLE = [
  { gate: 0, name: 'Version Consistency', hookOnly: true, evidence: 'VERSION and package.json' },
  { gate: 1, name: 'Code Quality', hookOnly: true, evidence: 'adapter lint output' },
  { gate: 2, name: 'Duplicate Code', hookOnly: false, evidence: 'jscpd configuration' },
  { gate: 3, name: 'Cyclomatic Complexity', hookOnly: false, evidence: 'ccn baseline' },
  { gate: 4, name: 'Principles', hookOnly: false, evidence: 'principles rc' },
  { gate: 5, name: 'Tests + Coverage', hookOnly: true, evidence: 'coverage summary' },
  { gate: 6, name: 'Architecture + Boy Scout', hookOnly: false, evidence: 'warnings baseline (see .warnings-baseline.json)' },
  { gate: 7, name: 'IaC Security', hookOnly: false, evidence: 'iac scanner configuration' },
  { gate: 8, name: 'Secret Scanning', hookOnly: false, evidence: 'secret scanner configuration' },
  { gate: 9, name: 'SAST Security', hookOnly: false, evidence: 'sast ruleset' },
  { gate: 10, name: 'Build Integrity', hookOnly: true, evidence: 'typecheck and pack' },
  { gate: 11, name: 'Sprint Flow', hookOnly: true, evidence: 'specification' },
  { gate: 12, name: 'File Hygiene', hookOnly: false, evidence: 'file hygiene script' },
  { gate: 13, name: 'Compiler Strictness', hookOnly: false, evidence: 'compiler strictness script' },
];

const BOY_SCOUT_GATE = 6;

/**
 * Read `.xp-gate/quality-status/<branch>.json` if present.
 * @param {string} repoRoot
 * @param {string} [branch]
 * @returns {{artifact: object|null, file: string|null}}
 */
function readQualityStatus(repoRoot, branch) {
  const dir = path.join(repoRoot, QUALITY_STATUS_DIR);
  const candidates = [];
  if (branch) candidates.push(path.join(dir, `${branch}.json`));
  // Fall back to any artifact: a branch name mismatch should still surface the
  // data (as STALE) rather than pretending nothing exists.
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.json')) candidates.push(path.join(dir, name));
    }
  } catch {
    return { artifact: null, file: null };
  }
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') return { artifact: parsed, file };
    } catch {
      /* malformed artifact: treat as absent, never as clean */
    }
  }
  return { artifact: null, file: null };
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

  return GATE_TABLE.map((spec) => {
    const entry = gates[GATE_NUMBER_TO_PRODUCER.get(spec.gate)];
    const row = {
      gate: spec.gate,
      name: spec.name,
      evidence: spec.evidence,
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
  return spec.hookOnly
    ? 'no result recorded — runs via git commit'
    : 'no result recorded — not run in the last report';
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
  const { artifact, file } = readQualityStatus(repoRoot, branch);
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
  GATE_TABLE,
  buildCoverageRows,
  renderGateCoverage,
  exitCodeFor,
  readQualityStatus,
  readBoyScoutDebt,
  readHookCoverageFloor,
  main,
};
