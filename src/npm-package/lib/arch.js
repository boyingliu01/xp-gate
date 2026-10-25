'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// #447: `xp-gate arch` used to shell out to
//   npx -y @archlinter/cli scan . --config architecture.yaml
// which failed twice over: `-y` pulls whatever the registry serves (version
// drift — REQ-4: "本机能跑、别人不能跑"), and this repo's pre-0.16
// `architecture.yaml` `rules:` block is rejected by archlint 0.16's own
// validator. The default path now runs the PINNED local @archlinter/cli with
// its built-in rules — the same rule source Gate 6 (pre-commit) uses — with
// baseline-ratchet verdicts when `.architecture-baseline.json` exists. The old
// config-driven path survives as the explicit opt-in `--use-config <file>`;
// `--config` remains as a deprecated alias.

const ARCHLINT_PACKAGE = '@archlinter/cli';
const BASELINE_FILE = '.architecture-baseline.json';
// Blocking threshold, aligned with Gate 6's pre-commit ratchet
// (`archlint diff .architecture-baseline.json --fail-on high`).
const FAIL_ON = 'high';
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
/**
 * Cap on captured archlint output.
 *
 * Written as a megabyte multiplier so the unit is in the name AND the literal is a
 * named constant — a bare 64 next to 1024 reads as an arbitrary product.
 */
const MEBIBYTE = 1024 * 1024;
const MAX_OUTPUT_MIB = 64;
const MAX_OUTPUT_BYTES = MAX_OUTPUT_MIB * MEBIBYTE;
const BLOCKING_PREVIEW_LIMIT = 10;

/**
 * Source extensions counted when measuring how much of a project a scan covered.
 *
 * Deliberately the same extension set archlint's detectors understand, plus the
 * mainstream statically-typed ones it does not — the point of the census is to notice
 * a project whose bulk is in a language no detector covers (#590's Java case), and
 * that only works if those files are counted.
 */
const LANGUAGE_BY_EXTENSION = new Map([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.java', 'java'],
  ['.kt', 'kotlin'],
  ['.kts', 'kotlin'],
  ['.py', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.cs', 'csharp'],
  ['.rb', 'ruby'],
  ['.php', 'php'],
  ['.swift', 'swift'],
  ['.dart', 'dart'],
  ['.scala', 'scala'],
  ['.c', 'c'],
  ['.cc', 'cpp'],
  ['.cpp', 'cpp'],
  ['.h', 'c'],
  ['.hpp', 'cpp'],
]);

/**
 * Windows extended-length prefixes (`\\?\C:\...`, `\\?\UNC\server\share\...`) —
 * strip for readable output. UNC first: its prefix also starts with `\\?\`.
 */
function stripExtendedPrefix(filePath) {
  return String(filePath)
    .replace(/^\\\\\?\\UNC\\/, '\\\\')
    .replace(/^\\\\\?\\/, '');
}

/**
 * Walk up from startDir to the git root. Falls back to startDir when no .git
 * marker exists (Gate 6 uses the same PROJECT_ROOT notion).
 */
function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  const fsRoot = path.parse(dir).root;
  while (dir !== fsRoot) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(startDir);
}

/**
 * Absolute path to the JS bin entry of an @archlinter/cli installation, or
 * null when the directory is not a usable installation. The bin field is
 * either a string or a map; the entry must exist on disk.
 */
function binEntryFromPackageDir(pkgDir) {
  const manifestPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(manifestPath)) return null;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
  const bin = typeof manifest.bin === 'string' ? { [manifest.name]: manifest.bin } : manifest.bin;
  if (!bin || typeof bin !== 'object') return null;
  const entry = bin.archlint || Object.values(bin)[0];
  if (!entry || typeof entry !== 'string') return null;
  const entryPath = path.resolve(pkgDir, entry);
  return fs.existsSync(entryPath) ? entryPath : null;
}

/** xp-gate's own pinned dependency: walk up from this file to its node_modules. */
function ownDependencyEntry() {
  let dir = __dirname;
  for (;;) {
    const entry = binEntryFromPackageDir(path.join(dir, 'node_modules', ARCHLINT_PACKAGE));
    if (entry) return entry;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** First match of `name` on PATH, or null. */
function findOnPath(name) {
  let lookup;
  try {
    lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
      encoding: 'utf8',
    });
  } catch (err) {
    // A throw here means the lookup binary itself is unavailable. That is "not found on
    // PATH", which is exactly what this function reports, not a reason to crash.
    console.error(`[xp-gate arch] PATH lookup for ${name} could not run: ${err.message}`);
    return null;
  }
  if (lookup.error || lookup.status !== 0 || !lookup.stdout) return null;
  const first = lookup.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return first && fs.existsSync(first) ? first : null;
}

/**
 * Resolve which archlint to run, in pin-priority order (REQ-4):
 *   1. xp-gate's own pinned dependency (version fixed by xp-gate's package.json)
 *   2. the target project's local node_modules install
 *   3. an `archlint` on PATH
 *   4. `npx --no-install @archlinter/cli` (local-only; NEVER `npx -y`)
 * `includeOwnDependency: false` skips step 1 (test seam for the lower tiers).
 */
function resolveArchlint(projectRoot, options = {}) {
  const includeOwnDependency = options.includeOwnDependency !== false;
  if (includeOwnDependency) {
    const own = ownDependencyEntry();
    if (own) return { kind: 'node-script', script: own, source: 'xp-gate dependency (pinned)' };
  }
  const local = binEntryFromPackageDir(path.join(projectRoot, 'node_modules', ARCHLINT_PACKAGE));
  if (local) return { kind: 'node-script', script: local, source: 'project node_modules' };
  const onPath = findOnPath('archlint');
  if (onPath) return { kind: 'binary', bin: onPath, source: 'PATH' };
  return { kind: 'npx', source: 'npx --no-install (local only)' };
}

/**
 * Quote an argv element for cmd.exe when shell mode is unavoidable.
 * Embedded double quotes are doubled (cmd's in-quote escape) and anything
 * carrying whitespace OR a quote is wrapped, so `a"b.yaml` cannot terminate
 * the quoting early and hand the rest to the shell. NOTE: this exists only
 * for the binary/npx fallback tiers on win32 — the default pinned path
 * spawns node directly against the JS entry with no shell at all.
 */
function quoteForShell(arg) {
  const s = String(arg);
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Run the resolved archlint. `capture` pipes stdout/stderr for parsing;
 * otherwise output is inherited so the user sees archlint's own report.
 * Returns { ok, status, stdout, stderr }; ok:false means the tool never ran.
 */
/**
 * Work out the executable + argument list for a resolved archlint.
 *
 * Split from `runArchlint` to keep that function inside the long-function limit, and
 * because the tier→invocation mapping is the part worth reading on its own: only the
 * `node-script` tier avoids a shell, which is why it is the pinned default.
 *
 * @param {{kind: string, script?: string, bin?: string}} resolved
 * @param {string[]} args arguments to the archlint CLI
 * @returns {{command: string, commandArgs: string[], useShell: boolean}}
 */
function archlintInvocation(resolved, args) {
  let command;
  let commandArgs;
  let useShell = false;
  if (resolved.kind === 'node-script') {
    // Spawn node against the JS entry: cross-platform, no .cmd/.ps1 shims.
    command = process.execPath;
    commandArgs = [resolved.script, ...args];
  } else if (resolved.kind === 'binary') {
    command = resolved.bin;
    commandArgs = args;
    useShell = process.platform === 'win32';
  } else {
    command = 'npx';
    commandArgs = ['--no-install', ARCHLINT_PACKAGE, ...args];
    useShell = process.platform === 'win32';
  }
  if (useShell) {
    command = quoteForShell(command);
    commandArgs = commandArgs.map(quoteForShell);
  }
  return { command, commandArgs, useShell };
}

/**
 * Report why archlint could not be launched, in terms the reader can act on.
 *
 * @param {{source: string}} resolved
 * @param {Error} error spawnSync's error, or a caught throw
 */
function reportLaunchFailure(resolved, error) {
  if (error.code === 'ENOENT') {
    console.error(`[xp-gate arch] ERROR: archlint not found (${resolved.source}).`);
    console.error(`  Fix: npm install --save-dev ${ARCHLINT_PACKAGE} in your project,`);
    console.error('  or reinstall xp-gate when its own pinned copy is the missing one.');
    return;
  }
  console.error(`[xp-gate arch] ERROR: failed to run archlint (${resolved.source}): ${error.message}`);
}

function runArchlint(resolved, args, { cwd, capture = false } = {}) {
  const { command, commandArgs, useShell } = archlintInvocation(resolved, args);
  let result;
  try {
    result = spawnSync(command, commandArgs, {
      cwd,
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: useShell,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (err) {
    // spawnSync normally reports launch failures via `result.error`; a throw means the
    // call itself was malformed. Both are "the tool never ran", which must never read as
    // a clean scan.
    console.error(`[xp-gate arch] ERROR: could not invoke archlint (${resolved.source}): ${err.message}`);
    return { ok: false, status: 1, stdout: '', stderr: '' };
  }
  if (result.error) {
    reportLaunchFailure(resolved, result.error);
    return { ok: false, status: 1, stdout: '', stderr: '' };
  }
  return {
    ok: true,
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

/**
 * Parse `archlint scan --format json` output into a verdict.
 * Fail-closed: unparseable output is reported as an error, never as "clean".
 */
/**
 * Below this fraction of the project's source files, a scan is treated as not having
 * covered the project.
 *
 * Not zero, because archlint legitimately analyses only the files its detectors
 * understand, and a polyglot repo will always have some files outside its extensions.
 * A quarter is deliberately generous: the case this exists for is 1-of-140, where any
 * threshold catches it, and a real JS/TS project sits far above 0.25.
 */
const MIN_ANALYSIS_COVERAGE = 0.25;

/**
 * Source-file census for the project, used to judge whether a scan covered it.
 *
 * Walks the tree once, skipping the usual vendored directories. Cheap enough to run
 * before a scan that takes seconds, and it is the ONLY way to know that
 * `files_analyzed: 1` is a fifth of a percent rather than "this project is tiny".
 *
 * A failure to count returns `{}` rather than a guess: an unknown project size must
 * leave the grade alone (see the `no project size known` case in the tests), never
 * produce a spurious "not covered" verdict.
 *
 * @param {string} projectRoot repository root
 * @returns {{projectFileCount?: number, dominantLanguage?: string}}
 */
function projectScanContext(projectRoot) {
  const counts = new Map();
  let total = 0;
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'coverage', 'vendor']);
  const walk = (dir, depth) => {
    // Depth bound: a symlink cycle would otherwise walk forever.
    if (depth > 24) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!LANGUAGE_BY_EXTENSION.has(ext)) continue;
      total += 1;
      const lang = LANGUAGE_BY_EXTENSION.get(ext);
      counts.set(lang, (counts.get(lang) || 0) + 1);
    }
  };
  walk(projectRoot, 0);
  if (total === 0) return {};
  let dominantLanguage;
  let best = -1;
  // Deterministic tie-break: candidates in sorted order, strict `>` keeps the first.
  for (const [lang, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > best) {
      best = n;
      dominantLanguage = lang;
    }
  }
  return { projectFileCount: total, dominantLanguage };
}

/**
 * Decide whether a scan covered enough of the project for its grade to mean anything.
 *
 * #590: a Java project with 140 `.java` files and no JS/TS got
 * `files_analyzed: 1`, `total_smells: 0`, and therefore `10.0 / Excellent`. archlint's
 * detectors are import-graph based over JS/TS extensions, so on that project every
 * architecture check Gate 6 exists for — cycles, god modules, dead code, shotgun
 * surgery — was silently skipped, while the report said the architecture was excellent.
 *
 * "Did not look" and "looked and found nothing" must be distinguishable. This is the
 * same shape as #589 (Gate 3 permanently SKIP) and #594 (NaN coverage as PASS): the
 * third instance today, which is why the check lives here rather than in the printer.
 *
 * @param {object|null} summary archlint's summary object
 * @param {{projectFileCount?: number, dominantLanguage?: string}} [context]
 * @returns {string|null} why the grade is untrustworthy, or null when it is fine
 */
function analysisCoverageGap(summary, context) {
  if (!summary) return null; // no grade at all: nothing to withhold
  const analyzed = Number(summary.files_analyzed);
  const total = Number(context && context.projectFileCount);
  // Without both numbers there is nothing to compare. Reporting a gap on a guess would
  // withhold grades from every caller that has not supplied a count — a worse outcome
  // than the defect, and the reason the existing arch tests keep working unchanged.
  if (!Number.isFinite(analyzed) || !Number.isFinite(total) || total <= 0) return null;
  if (analyzed >= total * MIN_ANALYSIS_COVERAGE) return null;

  const lang = (context && context.dominantLanguage) || 'the project';
  // The numbers are in the message on purpose: an operator who sees "1 of 140" believes
  // it, where "low coverage" reads as a threshold opinion.
  return `archlint analysed ${analyzed} of ${total} source file(s), so it did not cover ${lang}. Its grade is withheld.`;
}

function verdictFromScanJson(jsonText, context) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { parseError: 'archlint JSON output could not be parsed', total: 0, blocking: 0, blockingDetails: [] };
  }
  // A payload that parses but carries no `smells` array is schema drift, not a
  // clean tree: archlint 0.16.0 always emits `smells` on a successful JSON scan
  // (an empty run reports []). Reading the absence as "zero findings" would
  // silently PASS a renamed or restructured report — the exact no-op failure
  // class this rewrite exists to kill. Fail closed instead.
  if (!parsed || !Array.isArray(parsed.smells)) {
    return { parseError: 'archlint JSON output has no smells array (schema drift?)', total: 0, blocking: 0, blockingDetails: [] };
  }
  const smells = parsed.smells;
  let blocking = 0;
  const blockingDetails = [];
  for (const smell of smells) {
    const severity = String((smell && smell.severity) || '').toLowerCase();
    if (BLOCKING_SEVERITIES.has(severity)) {
      blocking += 1;
      if (blockingDetails.length < BLOCKING_PREVIEW_LIMIT) blockingDetails.push(smell);
    }
  }
  const summary = (parsed && parsed.summary) || null;
  // #590: withhold an untrustworthy grade. The findings themselves are still reported —
  // they are real regardless of how much was covered — but a 10.0 is a claim about a
  // project, and this is the check that stops the claim being made about a project that
  // was not read.
  const coverageGap = analysisCoverageGap(summary, context);
  return {
    parseError: null,
    total: smells.length,
    blocking,
    blockingDetails,
    summary: coverageGap ? null : summary,
    coverageGap,
  };
}

function printScanSummary(verdict) {
  if (verdict.coverageGap) {
    // Say it before the findings line: an operator reading top-down must know the grade
    // is missing and why, or the absence looks like a formatting quirk.
    console.log(`[xp-gate arch] Grade withheld: ${verdict.coverageGap}`);
    console.log('  Architecture was NOT measured for the languages archlint has no detector for.');
  }
  const grade = verdict.summary && verdict.summary.architecture_grade;
  if (grade && grade.score !== undefined) {
    console.log(`[xp-gate arch] Architecture quality: ${grade.score}/10 (${grade.level})`);
  }
  console.log(`[xp-gate arch] Findings: ${verdict.total} total, ${verdict.blocking} high/critical`);
  for (const smell of verdict.blockingDetails) {
    const files = Array.isArray(smell.files) ? smell.files.map(stripExtendedPrefix) : [];
    console.error(`  - [${smell.severity}] ${smell.type}${files.length ? ` @ ${files.join(', ')}` : ''}`);
  }
}

/**
 * Default path: built-in archlint rules, no config.
 * - `.architecture-baseline.json` present → baseline-ratchet mode, the exact
 *   verdict semantics of Gate 6's pre-commit path (`diff --fail-on high`):
 *   only NEW high/critical findings block, so an adopted legacy tree stays green.
 * - no baseline → zero-tolerance mode: any high/critical finding blocks.
 * Tool failures (spawn error, non-zero scan exit, unparseable JSON) always
 * exit non-zero — a broken scan must never read as a clean one.
 */
/**
 * Baseline-ratchet mode: only NEW high/critical findings block.
 *
 * Split out of `runBuiltinScan` to keep that function inside the long-function limit
 * (the #590 census pushed it over), and because this mode's contract — the exit code
 * itself IS the verdict — deserves to be readable in one place.
 *
 * @param {string} projectRoot repository root
 * @param {{kind: string}} resolved resolved archlint
 * @param {string} baselinePath path to the baseline file
 * @returns {number} exit code
 */
function runBaselineRatchet(projectRoot, resolved, baselinePath) {
  console.log(`[xp-gate arch] Baseline ratchet mode — ${BASELINE_FILE} present; blocking new ${FAIL_ON}+ findings only`);
  const diff = runArchlint(resolved, ['diff', baselinePath, '--fail-on', FAIL_ON], { cwd: projectRoot });
  if (!diff.ok) return 1;
  // `--fail-on high` makes the exit code itself the verdict contract: 0 = no new high+
  // findings, 1 = at least one. This is the exact mechanism Gate 6's pre-commit has used
  // since before #447, so parity here is the point, not a shortcut. Anything other than
  // 0/1 is a tool failure and blocks.
  if (diff.status === 0) {
    console.log(`✅ arch: no new ${FAIL_ON}+ architecture findings (baseline ratchet)`);
    return 0;
  }
  if (diff.status === 1) {
    console.error(`❌ BLOCKED - new ${FAIL_ON}+ architecture findings (baseline ratchet mode)`);
    console.error('  Fix the findings above, or refresh the baseline with:');
    console.error(`    npx ${ARCHLINT_PACKAGE} snapshot -o ${BASELINE_FILE}`);
    return 1;
  }
  console.error(`❌ ERROR - archlint diff exited ${diff.status}; tool failure is treated as blocking (never a silent pass)`);
  return 1;
}

function runBuiltinScan(projectRoot, resolved) {
  const baselinePath = path.join(projectRoot, BASELINE_FILE);
  if (fs.existsSync(baselinePath)) {
    return runBaselineRatchet(projectRoot, resolved, baselinePath);
  }

  console.log('[xp-gate arch] Zero-tolerance mode — no .architecture-baseline.json; blocking any high/critical finding');
  const scan = runArchlint(resolved, ['scan', '.', '--format', 'json', '--quiet'], {
    cwd: projectRoot,
    capture: true,
  });
  if (!scan.ok) return 1;
  // Empirically verified against @archlinter/cli 0.16.0: the JSON scan exits 1
  // exactly when high/critical findings exist (0 findings -> 0, medium-only ->
  // 0, any high -> 1); the table format always exits 0. Any other non-zero
  // status is a tool failure, never a verdict. The observation is bounded to
  // the PINNED release (step 1 of resolveArchlint, REQ-4), and
  // __tests__/arch.test.js re-runs that real binary, so a semantic change
  // fails tests instead of silently misreading the gate.
  if (scan.status !== 0 && scan.status !== 1) {
    console.error(`❌ ERROR - archlint scan exited ${scan.status}; tool failure is treated as blocking (never a silent pass)`);
    if (scan.stderr) process.stderr.write(scan.stderr);
    return 1;
  }
  // #590: give the verdict the two facts it needs to judge its own grade — how many
  // source files the project has, and which language dominates it. Without them a scan
  // of 1-of-140 files still reports 10.0/Excellent, which is the vacuous pass this
  // issue is about.
  const verdict = verdictFromScanJson(scan.stdout, projectScanContext(projectRoot));
  if (verdict.parseError) {
    console.error(`❌ ERROR - ${verdict.parseError}; tool failure is treated as blocking (never a silent pass)`);
    return 1;
  }
  printScanSummary(verdict);
  if (verdict.blocking > 0) {
    console.error(`❌ BLOCKED - ${verdict.blocking} high/critical architecture finding(s) (zero-tolerance mode)`);
    return 1;
  }
  if (scan.status === 1) {
    // archlint signalled failure but the parsed report shows no high/critical
    // finding — never silently pass on a verdict we cannot reproduce.
    console.error('❌ ERROR - archlint exited 1 but no high/critical finding was parsed; treating as blocking (fail-closed)');
    return 1;
  }
  console.log(`✅ arch: no high/critical architecture findings (zero-tolerance mode; ${verdict.total} finding(s) reported)`);
  return 0;
}

/**
 * Opt-in legacy path (`--use-config <file>`): the file is passed straight to
 * archlint as `--config`. archlint validates its own schema, so pre-0.16 files
 * (this repo's architecture.yaml `rules:` block) are rejected by archlint
 * itself — schema-version responsibility sits with the user who opts in.
 */
function runWithConfig(configPath, projectRoot, resolved) {
  console.warn(`[xp-gate arch] NOTE: opt-in config path — passing ${configPath} to archlint --config.`);
  console.warn('  archlint validates its own config schema; pre-0.16 files (e.g. an architecture.yaml');
  console.warn('  with a `rules:` block) are rejected by archlint itself. The default built-in-rules');
  console.warn('  path needs no config at all.');
  const scan = runArchlint(resolved, ['scan', '.', '--config', configPath], { cwd: projectRoot });
  if (!scan.ok) return 1;
  return scan.status;
}

function arch(args) {
  const useConfigIdx = args.indexOf('--use-config');
  const legacyIdx = args.indexOf('--config');
  if (useConfigIdx >= 0 && legacyIdx >= 0) {
    console.error('[xp-gate arch] ERROR: pass either --use-config or --config, not both');
    return Promise.resolve(1);
  }
  if (legacyIdx >= 0) {
    console.warn('[xp-gate arch] NOTE: --config is deprecated; use --use-config (same behavior, clearer intent)');
  }
  const configIdx = useConfigIdx >= 0 ? useConfigIdx : legacyIdx;
  const config = configIdx >= 0 ? args[configIdx + 1] : null;
  if (configIdx >= 0 && (!config || config.startsWith('--'))) {
    console.error(`[xp-gate arch] ERROR: ${useConfigIdx >= 0 ? '--use-config' : '--config'} requires a file path`);
    return Promise.resolve(1);
  }

  const projectRoot = findProjectRoot(process.cwd());
  const resolved = resolveArchlint(projectRoot);

  if (config) {
    const configPath = path.resolve(process.cwd(), config);
    if (!fs.existsSync(configPath)) {
      console.error(`[xp-gate arch] ERROR: config file not found: ${config}`);
      return Promise.resolve(1);
    }
    return Promise.resolve(runWithConfig(configPath, projectRoot, resolved));
  }

  console.log(`[xp-gate arch] Project root: ${projectRoot}`);
  console.log(`[xp-gate arch] archlint: ${resolved.source}${resolved.script ? ` (${resolved.script})` : ''}`);
  return Promise.resolve(runBuiltinScan(projectRoot, resolved));
}

module.exports = {
  arch,
  // Test seams (anti-noop verification needs to reach the resolution and
  // verdict layers without shelling out; see __tests__/arch.test.js).
  __internals: {
    findProjectRoot,
    binEntryFromPackageDir,
    resolveArchlint,
    verdictFromScanJson,
    analysisCoverageGap,
    projectScanContext,
    quoteForShell,
    stripExtendedPrefix,
    BLOCKING_SEVERITIES,
    BASELINE_FILE,
  },
};
