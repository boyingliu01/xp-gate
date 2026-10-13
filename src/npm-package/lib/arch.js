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
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const BLOCKING_PREVIEW_LIMIT = 10;

/** Windows extended-length prefix (`\\?\C:\...`) — strip for readable output. */
function stripExtendedPrefix(filePath) {
  return String(filePath).replace(/^\\\\\?\\/, '');
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
  const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    encoding: 'utf8',
  });
  if (lookup.status !== 0 || !lookup.stdout) return null;
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

/** Quote an argv element for cmd.exe when shell mode is unavoidable. */
function quoteForShell(arg) {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

/**
 * Run the resolved archlint. `capture` pipes stdout/stderr for parsing;
 * otherwise output is inherited so the user sees archlint's own report.
 * Returns { ok, status, stdout, stderr }; ok:false means the tool never ran.
 */
function runArchlint(resolved, args, { cwd, capture = false } = {}) {
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
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: useShell,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.error(`[xp-gate arch] ERROR: archlint not found (${resolved.source}).`);
      console.error(`  Install it in your project: npm install --save-dev ${ARCHLINT_PACKAGE}`);
    } else {
      console.error(`[xp-gate arch] ERROR: failed to run archlint (${resolved.source}): ${result.error.message}`);
    }
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
function verdictFromScanJson(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { parseError: 'archlint JSON output could not be parsed', total: 0, blocking: 0, blockingDetails: [] };
  }
  const smells = parsed && Array.isArray(parsed.smells) ? parsed.smells : [];
  let blocking = 0;
  const blockingDetails = [];
  for (const smell of smells) {
    const severity = String((smell && smell.severity) || '').toLowerCase();
    if (BLOCKING_SEVERITIES.has(severity)) {
      blocking += 1;
      if (blockingDetails.length < BLOCKING_PREVIEW_LIMIT) blockingDetails.push(smell);
    }
  }
  return {
    parseError: null,
    total: smells.length,
    blocking,
    blockingDetails,
    summary: (parsed && parsed.summary) || null,
  };
}

function printScanSummary(verdict) {
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
function runBuiltinScan(projectRoot, resolved) {
  const baselinePath = path.join(projectRoot, BASELINE_FILE);
  if (fs.existsSync(baselinePath)) {
    console.log(`[xp-gate arch] Baseline ratchet mode — ${BASELINE_FILE} present; blocking new ${FAIL_ON}+ findings only`);
    const diff = runArchlint(resolved, ['diff', baselinePath, '--fail-on', FAIL_ON], { cwd: projectRoot });
    if (!diff.ok) return 1;
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

  console.log('[xp-gate arch] Zero-tolerance mode — no .architecture-baseline.json; blocking any high/critical finding');
  const scan = runArchlint(resolved, ['scan', '.', '--format', 'json', '--quiet'], {
    cwd: projectRoot,
    capture: true,
  });
  if (!scan.ok) return 1;
  // Empirically verified against @archlinter/cli 0.16.0: the JSON scan exits 1
  // exactly when high/critical findings exist (0 findings -> 0, medium-only ->
  // 0, any high -> 1); the table format always exits 0. Any other non-zero
  // status is a tool failure, never a verdict.
  if (scan.status !== 0 && scan.status !== 1) {
    console.error(`❌ ERROR - archlint scan exited ${scan.status}; tool failure is treated as blocking (never a silent pass)`);
    if (scan.stderr) process.stderr.write(scan.stderr);
    return 1;
  }
  const verdict = verdictFromScanJson(scan.stdout);
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
    quoteForShell,
    stripExtendedPrefix,
    BLOCKING_SEVERITIES,
    BASELINE_FILE,
  },
};
