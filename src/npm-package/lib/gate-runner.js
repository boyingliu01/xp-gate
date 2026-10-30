const { execSync, execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Source-file extensions the gate fragments know how to analyse.
 *
 * Shared by the `--all` scope resolver so a full-tree check and the adapters agree
 * on what a "source file" is. Data and documentation formats are deliberately
 * absent: handing a markdown file to lizard is not a check, it is noise.
 */
const SOURCE_FILE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'go', 'java', 'kt', 'kts', 'scala',
  'c', 'cc', 'cpp', 'cxx', 'h', 'hpp',
  'rs', 'php', 'dart', 'swift', 'm', 'mm',
  'sh', 'bash', 'ps1', 'psm1', 'rb',
];

/**
 * Every tracked source file in the repository, one per line.
 *
 * This is what `--all` must hand the gates that read CHANGED_FILES.
 *
 * #589: `check --all` was documented as a full-tree check but still built
 * CHANGED_FILES from `git diff`, so on a clean tree — the normal state after a
 * commit, and the state CI runs in — Gate 3 received an empty list and printed
 *
 *     ⏭️  SKIPPED - Complexity (no source files to check)
 *
 * `--all` therefore checked LESS than an ordinary commit, while reading like a
 * pass. Gate 4 does not depend on CHANGED_FILES and worked fine under the same
 * preamble, which is what proves the file SOURCE was the defect.
 *
 * @param {string} [cwd] repository directory
 * @returns {string} newline-separated repo-relative paths, empty on any failure
 */
function resolveAllModeChangedFiles(cwd = process.cwd()) {
  const pathspecs = SOURCE_FILE_EXTENSIONS.map((ext) => `*.${ext}`);
  try {
    const out = execFileSync('git', ['ls-files', ...pathspecs], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter(Boolean).join('\n');
  } catch {
    // Not a git repo, or git missing: an empty list is honest, and the caller's
    // message distinguishes "empty diff" from "empty tree".
    return '';
  }
}

/**
 * Explain an empty CHANGED_FILES honestly, given which scope produced it.
 *
 * The old wording ("no source files to check") described an empty PROJECT when
 * the actual cause was an empty DIFF — and the natural reading of the old message
 * is "this gate passed". #589's reporter worked around it by running lizard by
 * hand, which is the cost of an ambiguous skip.
 *
 * @param {'diff'|'all'} scope which scope was used
 * @param {number} count number of files in the list
 * @returns {string} one line, no trailing newline
 */
function describeEmptyChangedFiles(scope, count) {
  if (count > 0) {
    return scope === 'all'
      ? `${count} tracked source file(s) in scope (--all: whole tree)`
      : `${count} changed source file(s) in scope`;
  }
  if (scope === 'all') {
    return 'no tracked source files in this repository (--all already scanned the whole tree)';
  }
  // Name the real cause and the action that fixes it. Deliberately does NOT say
  // "no source files": that describes the project, which is not what happened.
  return 'no changed files in this run (0 staged, 0 vs HEAD) — run with `--all` to scan the whole tree';
}

/**
 * Report which scope a gate actually used.
 *
 * A silent switch between diff and tree is the same defect one level up: the
 * reader cannot tell what was inspected. Printed once per standalone run so
 * "full check" cannot quietly mean "diff check".
 *
 * @param {'diff'|'all'} scope
 * @param {number} count
 * @returns {string}
 */
function describeChangedFilesScope(scope, count) {
  const label = scope === 'all' ? 'all' : 'diff';
  return `scope: ${label} (${count} file(s))`;
}

/**
 * Which bash can run the gate fragments.
 *
 * On Windows, PATH may lead with the WSL System32 stub, which cannot run these
 * hooks (Linux filesystem view, and `-c` scripts receive an empty $1 through it).
 * checkBash probes for an MSYS/MINGW bash that round-trips argv correctly.
 *
 * @returns {string|null} the bash command, or null when only an unusable one exists
 */
function resolveBashForGates() {
  if (process.platform !== 'win32') return 'bash';
  const { checkBash } = require('./detect-deps.js');
  const bash = checkBash();
  return bash.ok ? bash.path : null;
}

/**
 * The first candidate that exists on disk, or the empty string.
 *
 * The empty string (not a throw) is deliberate: the preamble tolerates a missing
 * helper script and the fragment then fails the same way it does in the commit
 * hook.
 *
 * @param {string[]} candidates paths to try in order
 * @returns {string}
 */
function firstExisting(candidates) {
  try {
    return candidates.find(candidate => fs.existsSync(candidate)) || '';
  } catch {
    // existsSync only throws on a malformed path; treat that as "none".
    return '';
  }
}

/**
 * Write the `--all` file list to a temporary file and return its path.
 *
 * The list is one line per tracked file (thousands on a real repository), so it
 * cannot travel as a `bash -c` argument: on Windows the whole script is a single
 * command-line string capped at 32,767 characters, and exceeding it surfaced as
 * `spawnSync bash ENAMETOOLONG` — Gate 3 could not run at all under `--all`.
 *
 * Inlining was also semantically broken: `JSON.stringify` escapes the separators
 * to a literal `\n`, and bash does not interpret escape sequences inside double
 * quotes, so the gates received one long non-existent path instead of a list.
 *
 * @param {string} contents newline-separated file list
 * @returns {string} path to the temp file
 */
function writeAllModeFileList(contents) {
  const listFile = path.join(os.tmpdir(), `xp-gate-all-files-${process.pid}-${Date.now()}.txt`);
  try {
    fs.writeFileSync(listFile, contents, 'utf8');
  } catch (err) {
    throw new Error(`xp-gate: cannot write the --all file list to ${listFile}: ${err.message}`);
  }
  return listFile;
}

/**
 * Remove the temporary file list, if one was written.
 *
 * Best effort: a leftover file in the temp directory is not worth failing a gate
 * over, but a failure other than ENOENT is named so it does not go unnoticed.
 *
 * @param {string} listFile path to remove, or the empty string
 */
function removeFileList(listFile) {
  if (!listFile) return;
  try {
    fs.unlinkSync(listFile);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[xp-gate] could not remove ${listFile}: ${err.message}`);
    }
  }
}

/**
 * The shell lines that populate CHANGED_FILES, chosen by scan scope.
 *
 * Extracted so `runGateAdapter` stays readable: the diff form is three lines of
 * git plumbing and the tree form is a single read, and mixing them inline made
 * the wrapper harder to follow than the thing it wraps.
 *
 * @param {boolean} allMode true for `--all` (whole tree)
 * @returns {string[]} shell lines
 */
function buildFileSourceLines(allMode) {
  if (allMode) {
    return ['#589: --all scans the tracked tree, not the diff ($5 = file list)', 'CHANGED_FILES="$(cat "$5" 2>/dev/null || true)"'];
  }
  // The historical diff form, unchanged: staged first, then anything vs HEAD.
  // Interpolating the literal `${CHANGED_FILES}` brace-by-brace would be torn apart
  // by this file's own template literals, hence the split below.
  const changedFilesParameter = ['$', '{CHANGED_FILES}'].join('');
  return [
    'CHANGED_FILES="$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)"',
    `if [ -z "${changedFilesParameter}" ] && [ -n "$(git rev-parse HEAD 2>/dev/null)" ]; then`,
    '  CHANGED_FILES="$(git diff HEAD --name-only --diff-filter=ACM 2>/dev/null || true)"',
    'fi',
  ];
}

/**
 * Run a gate adapter fragment standalone.
 *
 * The gate fragments in githooks/adapters/gate-*.sh are designed to be *sourced*
 * into the pre-commit hook, which pre-defines the context they rely on:
 *   - PROJECT_LANG (from detect_project_lang)
 *   - CHANGED_FILES (from git)
 *   - gate_start_ms() / record_gate_audit() / now_ms() audit & timing helpers
 *
 * When `xp-gate check` invokes a gate standalone, that context is missing and
 * the fragments fail with "command not found". This wrapper reconstructs the
 * same preamble the pre-commit hook sets up, then *sources* the fragment so it
 * behaves exactly as it does inside the commit hook.
 *
 * @param {string} scriptPath gate fragment to source
 * @param {string} [cwd] project directory
 * @param {{scope?: 'diff'|'all'}} [opts] `all` resolves CHANGED_FILES from the
 *   tracked tree instead of the diff (#589)
 */
function runGateAdapter(scriptPath, cwd = process.cwd(), opts = {}) {
  const bashCommand = resolveBashForGates();
  if (!bashCommand) {
    console.log('⚠️  This gate requires bash to run shell scripts.');
    // No WSL suggestion: these hooks need Git Bash specifically — the WSL bash is
    // rejected by the probe (Linux filesystem view, dropped $1).
    console.log('   On Windows, install Git for Windows (https://git-scm.com/download/win).');
    console.log('   Alternatively, install the required tool directly and run the gate again.');
    return;
  }
  const scriptDir = path.dirname(scriptPath);
  const commonScript = firstExisting([
    path.join(scriptDir, 'adapter-common.sh'),
    path.join(scriptDir, '..', 'adapter-common.sh'),
    path.join(cwd, 'githooks', 'adapter-common.sh'),
  ]);
  const nowMsScript = firstExisting([
    path.join(scriptDir, 'lib', 'now-ms.sh'),
    path.join(scriptDir, '..', 'lib', 'now-ms.sh'),
    path.resolve(__dirname, '..', 'hooks', 'lib', 'now-ms.sh'),
  ]);
  // #589: the scope determines the file SOURCE. Under `--all` the gates that read
  // CHANGED_FILES must see the whole tree, not the diff — otherwise a full check
  // scans less than an ordinary commit and reads like a pass.
  const allMode = opts.scope === 'all';
  const listFile = allMode ? writeAllModeFileList(resolveAllModeChangedFiles(cwd)) : '';
  try {
    const wrap = buildPreamble(allMode, buildFileSourceLines(allMode));

    // execFileSync avoids an extra /bin/sh layer, so bash receives the script as a
    // single argv arg (no shell-metacharacter injection through the path).
    execFileSync(
      bashCommand,
      ['--noprofile', '--norc', '-c', wrap, 'xp-gate', commonScript, nowMsScript, scriptPath, process.execPath, listFile],
      // #660: the pre-commit hook exports GATE_DIR before sourcing a fragment, but
      // the CLI path never did, so gate-3.sh looked for $GATE_DIR/lib/ccn-ratchet.sh
      // (empty), fell back to <repo>/githooks/lib, and falsely BLOCKED on any
      // project without vendored gates. The fragment lives beside its lib/, so
      // point GATE_DIR at its own directory.
      { stdio: 'inherit', cwd, env: { ...process.env, GATE_DIR: scriptDir } }
    );
  } finally {
    removeFileList(listFile);
  }
}

/**
 * The shell preamble the pre-commit hook would otherwise inject before sourcing a
 * gate fragment.
 *
 * Deliberately NOT `set -u` (the pre-commit hook does not use it), so fragments
 * that reference a not-yet-defined variable fail the same way inside the commit
 * hook.
 *
 * @param {boolean} allMode whether the run scope is the whole tree
 * @param {string[]} fileSourceLines lines that populate CHANGED_FILES
 * @returns {string} the script to hand bash with -c
 */
function buildPreamble(allMode, fileSourceLines) {
  return [
    'if [ -n "$1" ] && [ -f "$1" ]; then source "$1"; fi',
    'if [ -n "$2" ] && [ -f "$2" ]; then source "$2"; fi',
    'if ! command -v now_ms >/dev/null 2>&1; then now_ms() { "$4" -e "console.log(Date.now())"; }; fi',
    'gate_start_ms() { now_ms; }',
    'record_gate_audit() { :; }',
    'PROJECT_LANG="$(detect_project_lang 2>/dev/null || echo unknown)"',
    // #589: fragments need to know which scope produced the file list, so an empty
    // list can say "empty diff" instead of "empty project".
    `GATE_SCOPE=${JSON.stringify(allMode ? 'all' : 'diff')}`,
    ...fileSourceLines,
    'source "$3"',
  ].join('\n');
}

// Gate metadata registry — maps gate IDs to names, descriptions, and how to run them.
// Standalone gates (<gate-id>: { run }) are invokable via xp-gate gate-<id>.
// Pre-commit-only gates (<gate-id>: { preCommitOnly: true }) run only in git commit context.

/**
 * Wall-clock budget for one TypeScript gate run.
 *
 * Generous on purpose: `gate-5-runner-error.test.ts` alone takes ~400s on CI, and a
 * gate killed for being slow must be reported as "did not report a verdict", never
 * silently counted as a pass.
 */
const TS_GATE_TIMEOUT_MS = 120000;

/**
 * #618: sentinel for "this gate ran nothing at all" -- no TypeScript module and
 * no bash fallback. It must never be conflated with 0 ("ran, found nothing").
 * Returned up through runGate() so the --all summary counts it as skipped
 * rather than passed: three advertised gates were analysing nothing and sitting
 * inside the passed count, which is the same defect class as a vacuous pass
 * elsewhere -- a dimension nobody measured, scored as if measured.
 */
const GATE_NOT_RUN = 'NOT_RUN';

/**
 * Run a TypeScript gate module via npx tsx.
 * Finds the .ts entry point, spawns tsx with --run flag.
 * Falls back to bash script if TypeScript module not found.
 */
function runTsGate(gateModule, targetPath, opts = {}) {
  const targetCwd = targetPath ? path.resolve(targetPath) : process.cwd();
  const entry = findTsGateEntry(gateModule);
  if (!entry) {
    // Fallback to bash script
    const gateNum = gateModule.replace('gate-', '');
    const script = resolveGateScript(gateNum, targetCwd);
    if (script) {
      return runGateAdapter(script, targetCwd, opts);
    }
    // #618: nothing ran. Before this, the function fell through to `return 0`
    // and the --all summary counted the gate as passed.
    console.log(`Gate ${gateModule}: TypeScript module not found and no bash fallback available.`);
    console.log(`⏭️  SKIPPED - Gate ${gateModule} did not run (no module, no bash fallback)`);
    return GATE_NOT_RUN;
  }

  const args = ['-y', 'tsx', entry, '--run'];
  if (targetPath) args.push('--cwd', targetPath);

  // spawnSync reports a spawn failure (npx missing) on `error`, throws only on a
  // malformed argv, and reports a killed child (timeout, signal) as a null status.
  // All three mean "the gate did not report a verdict", which must not be read as
  // success: a gate that never ran is not a gate that passed.
  try {
    const result = spawnSync('npx', args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd: targetCwd,
      timeout: TS_GATE_TIMEOUT_MS,
    });
    if (result.error) {
      console.error(`Gate ${gateModule}: failed to run npx tsx: ${result.error.message}`);
      return 1;
    }
    return result.status === null ? 1 : result.status;
  } catch (err) {
    console.error(`Gate ${gateModule}: could not spawn npx tsx: ${err.message}`);
    return 1;
  }
}

function findTsGateEntry(gateModule) {
  const candidates = [
    // Development layout
    path.resolve(__dirname, '..', '..', '..', 'src', 'gates', `${gateModule}.ts`),
    // npm package bundled layout
    path.resolve(__dirname, '..', 'gates', `${gateModule}.ts`),
    // node_modules install
    path.resolve(__dirname, '..', '..', 'src', 'gates', `${gateModule}.ts`),
    // Repo root
    path.resolve(process.cwd(), 'src', 'gates', `${gateModule}.ts`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
// allow: SIZE_OK - this module's bulk is the declarative gate registry below.
const GATE_REGISTRY = {
  '0': {
    name: 'Version Consistency',
    description: 'Check VERSION file matches all package.json versions',
    aliases: ['version', '0'],
    preCommitOnly: true,
    reason: 'Requires git-staged context to compare VERSION with package.json files',
  },
  '1': {
    name: 'Code Quality',
    description: 'Language-specific static analysis and linting (ESLint, Ruff, govet, etc.)',
    aliases: ['lint', '1'],
    preCommitOnly: true,
    reason: 'Requires language detection from changed files and adapter routing',
  },
  '2': {
    name: 'Duplicate Code',
    description: 'jscpd duplicate code detection',
    aliases: ['duplicates', 'dup', '2'],
    run: (targetPath) => {
      const jscpdConfig = findConfig(targetPath, 'jscpd.conf.json');
      const args = [targetPath || '.'];
      if (jscpdConfig) args.push('--config', jscpdConfig);
      execFileSync('npx', ['-y', 'jscpd', ...args], { stdio: 'inherit', shell: true });
    },
  },
  '3': {
    name: 'Cyclomatic Complexity',
    description: 'lizard cyclomatic complexity analysis',
    aliases: ['complexity', 'ccn', '3'],
    run: (targetPath, opts) => {
      return runTsGate('gate-3', targetPath, opts);
    },
  },
  '4': {
    name: 'Clean Code + SOLID Principles',
    description: '14 Clean Code/SOLID rules across 9 languages',
    aliases: ['principles', 'principle', '4'],
    run: (targetPath) => {
      const { principles } = require('./principles.js');
      return principles([targetPath || '.']);
    },
  },
  '5': {
    name: 'Tests + Coverage',
    description: 'Unit test execution and code coverage enforcement (≥80%)',
    aliases: ['tests', 'test', '5'],
    preCommitOnly: true,
    reason: 'Requires language detection and adapter-sourced test execution with coverage reports',
  },
  '6': {
    name: 'Architecture + Boy Scout Rule',
    description: 'Architecture layer boundary validation and warning baseline enforcement',
    aliases: ['architecture', 'arch', '6'],
    run: () => {
      const { arch } = require('./arch.js');
      return arch([]);
    },
  },
  '7': {
    name: 'IaC Security',
    description: 'Infrastructure-as-Code security scanning (checkov, hadolint, kube-score, tflint)',
    aliases: ['iac', 'infra', '7'],
    run: (targetPath) => {
      return runTsGate('gate-7', targetPath);
    },
  },
  '8': {
    name: 'Secret Scanning',
    description: 'gitleaks secret and credential detection',
    aliases: ['secrets', 'secret', '8'],
    run: (targetPath) => {
      return runTsGate('gate-8', targetPath);
    },
  },
  '9': {
    name: 'SAST Security',
    description: 'semgrep static application security testing',
    aliases: ['sast', 'semgrep', '9'],
    run: (targetPath) => {
      return runTsGate('gate-9', targetPath);
    },
  },
  '10': {
    name: 'Build Integrity',
    description: 'TypeScript compilation, npm pack, and import validation',
    aliases: ['build', '10'],
    preCommitOnly: true,
    reason: 'Build integrity checks require language detection and build tool context',
  },
  '11': {
    name: 'Sprint Flow Enforcement',
    description: 'Sprint state and delphi-review validation',
    aliases: ['sprint', '11'],
    preCommitOnly: true,
    reason: 'Requires sprint state (.sprint-state/) and git branch context',
  },
  'python-health': {
    name: 'Python Environment Health',
    description: 'Comprehensive Python environment diagnostics',
    aliases: ['python-health', 'py-health'],
    run: (targetPath) => {
      return runTsGate('python-health', targetPath);
    },
  },
  'test-layers': {
    name: 'Test Layer Analytics',
    description: 'Report test distribution across unit/integration/e2e layers',
    aliases: ['test-layers', 'layers', 'test-analytics'],
    run: (targetPath) => {
      return runTsGate('test-layers', targetPath);
    },
  },
  'pbt': {
    name: 'Property-Based Testing Detection',
    description: 'Detect PBT framework usage and report coverage',
    aliases: ['pbt', 'pbt-detect', 'property-based-testing'],
    run: (targetPath) => {
      return runTsGate('pbt-detect', targetPath);
    },
  },
};

// Reverse-lookup: alias → gate ID (built once at module load)
const ALIAS_MAP = {};
(function buildAliasMap() {
  for (const [id, info] of Object.entries(GATE_REGISTRY)) {
    const aliases = Array.isArray(info.aliases) ? info.aliases : [];
    for (const alias of aliases) {
      ALIAS_MAP[String(alias).toLowerCase()] = id;
    }
  }
})();

/**
 * Resolve a gate alias (name or number string) to its canonical gate ID.
 * Returns null if no match.
 */
function resolveAlias(maybeAlias) {
  if (maybeAlias == null) return null;
  const key = String(maybeAlias).toLowerCase();
  // Direct numeric ID lookup
  if (GATE_REGISTRY[key]) return key;
  // Alias lookup
  return ALIAS_MAP[key] || null;
}

/**
 * Get all aliases for a given gate ID, or empty array.
 */
function getAliases(gateId) {
  const info = GATE_REGISTRY[String(gateId)];
  return info && Array.isArray(info.aliases) ? info.aliases : [];
}

function findConfig(basePath, fileName) {
  const candidates = [
    path.join(basePath || '.', fileName),
    path.join(process.cwd(), fileName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * The basename of the first `gate-<num>-*.sh` in a directory, or null.
 *
 * A missing directory is the normal case -- most projects have no
 * `githooks/gates/` -- so it returns null rather than throwing.
 *
 * @param {string} dir directory to list
 * @param {string} gateNum gate number as a string
 * @returns {string|null}
 */
function matchGateFileIn(dir, gateNum) {
  try {
    if (!fs.existsSync(dir)) return null;
    return fs.readdirSync(dir).find(f => f.startsWith(`gate-${gateNum}-`) && f.endsWith('.sh')) || null;
  } catch {
    return null;
  }
}

/**
 * Locate the bash script that implements a gate, for the TS-less fallback path.
 *
 * Candidate order:
 *   1. `<cwd>/githooks/gates/gate-<n>-*.sh` -- a consumer's OWN gate scripts. The
 *      hyphenated name is what lets a project keep several variants of one gate
 *      (`gate-9-public-fallback.sh`), which the flat `gate-<n>.sh` name cannot
 *      express. `xp-gate init` does not create this directory and the npm package
 *      does not ship it, so in a stock project it simply never matches. It is
 *      still a supported extension point, pinned by the REQ-standalone-gates-05
 *      and -06 tests in lib/__tests__/gate-runner.test.js.
 *   2. `<cwd>/githooks/gate-<n>.sh` -- the flat copy `xp-gate init` installs.
 *   3. `~/.config/xp-gate/adapters/gate-<n>.sh` -- the global install.
 *
 * NOTE: this repository's own `githooks/gates/` was a different thing entirely --
 * five drifted copies of the canonical gates that only ever matched inside this
 * checkout, shadowing `githooks/gate-N.sh` (36 lines apart for gate-9, still
 * carrying the GATE_10_STATUS artifact from #532). Those were deleted; the
 * lookup path above was not, because consumer projects legitimately use it.
 *
 * @param {string} gateNum gate number as a string
 * @param {string} cwd project root to search
 * @returns {string|null}
 */
function resolveGateScript(gateNum, cwd = process.cwd()) {
  const gatesDir = path.join(cwd, 'githooks', 'gates');
  const flexible = matchGateFileIn(gatesDir, gateNum);
  if (flexible) return path.join(gatesDir, flexible);

  const projectScript = path.join(cwd, 'githooks', `gate-${gateNum}.sh`);
  if (fs.existsSync(projectScript)) return projectScript;

  // Check global install
  const globalDir = path.join(os.homedir(), '.config', 'xp-gate', 'adapters');
  const globalScript = path.join(globalDir, `gate-${gateNum}.sh`);
  if (fs.existsSync(globalScript)) return globalScript;

  return null;
}

function getGateInfo(gateId) {
  return GATE_REGISTRY[String(gateId)] || null;
}

function getAllGates() {
  return Object.entries(GATE_REGISTRY).map(([id, info]) => ({
    id,
    name: info.name,
    description: info.description,
    aliases: Array.isArray(info.aliases) ? info.aliases : [],
    preCommitOnly: info.preCommitOnly || false,
    reason: info.reason || null,
  }));
}

async function runGate(gateId, targetPath, opts = {}) {
  const gate = GATE_REGISTRY[String(gateId)];
  if (!gate) {
    console.error(`Unknown gate: ${gateId}`);
    console.error(`Available gates: ${Object.keys(GATE_REGISTRY).join(', ')}`);
    return 1;
  }

  if (gate.preCommitOnly) {
    console.log(`━━━ Gate ${gateId}: ${gate.name} ━━━`);
    console.log(`⏭️  SKIPPED - ${gate.reason}`);
    console.log('   This gate runs automatically during git commit.');
    console.log('   Run: git commit to trigger all gates.');
    return 0;
  }

  if (gate.run) {
    console.log(`━━━ Gate ${gateId}: ${gate.name} ━━━`);
    try {
      // #589: pass the scope through so a handler that shells out to a fragment
      // can resolve its file list from the tree under --all. Handlers that ignore
      // the second argument are unaffected.
      const result = gate.run(targetPath, opts);
      if (result && typeof result.then === 'function') {
        return await result;
      }
      // A synchronous handler's verdict MUST be propagated (#563). Gates 3, 7,
      // 8 and 9 reach runTsGate(), which returns a plain number; reporting a
      // manufactured 0 for them made `xp-gate check` unable to distinguish a
      // failing gate from a passing one. Handlers that return nothing at all
      // (gate 2, whose execFileSync throws on a non-zero exit instead) are
      // still treated as pass, because their failure signal is the throw below.
      if (result === GATE_NOT_RUN) return GATE_NOT_RUN;
      return typeof result === 'number' ? result : 0;
    } catch (err) {
      // Covers a synchronous throw AND a rejection from the awaited handler.
      console.error(` Gate ${gateId} FAILED: ${err.message}`);
      return 1;
    }
  }

  console.error(`Gate ${gateId}: ${gate.name} — no execution handler available`);
  return 1;
}

module.exports = { GATE_REGISTRY, GATE_NOT_RUN, getGateInfo, getAllGates, runGate, resolveAlias, getAliases, runGateAdapter, findTsGateEntry, resolveGateScript, SOURCE_FILE_EXTENSIONS, resolveAllModeChangedFiles, describeEmptyChangedFiles, describeChangedFilesScope };
