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
/**
 * Resolve the working directory for a gate run.
 *
 * `targetPath` is documented as "file or directory" (that is what
 * `xp-gate check <file>` passes), but spawnSync's `cwd` must be a directory.
 * Resolving a FILE path into cwd made spawnSync fail with a bare ENOENT that read
 * as "Gate 3 failed to run npx tsx" — a tool failure reported under the label of a
 * code verdict. The file's own directory is the meaningful cwd in that case.
 */
function resolveGateCwd(targetPath) {
  if (!targetPath) return process.cwd();
  const resolved = path.resolve(targetPath);
  try {
    if (fs.statSync(resolved).isFile()) return path.dirname(resolved);
  } catch {
    // Nonexistent path: leave it for the gate itself to report.
  }
  return resolved;
}

/**
 * Resolve how to invoke npx without a shell.
 *
 * `shell: true` on Windows looked like the right fix for resolving npx.cmd, but
 * node passes the argv to CreateProcess as one concatenated string without
 * escaping (DEP0190) — so any entry path with a backslash or space produced a
 * malformed command line and spawnSync failed with a bare ENOENT. The gate then
 * reported FAIL while nothing had actually run: a tool failure wearing the verdict
 * "your code is broken".
 *
 * Calling npx.cmd directly is not the fix either: since the CVE-2024-27980
 * hardening, node refuses .cmd/.bat from spawnSync without a shell and returns
 * EINVAL. Running npx's own cli.js with the current node binary sidesteps both —
 * plain argv, no shell, no batch wrapper.
 */
function resolveNpxInvocation(args) {
  const npxCli = findNpxCli();
  if (npxCli) return [process.execPath, [npxCli, ...args]];
  return ['npx', args];
}

/**
 * npm's own shell-free entry point (`npx-cli.js`), or null.
 *
 * The previous form looked only in `dirname(process.execPath)/node_modules/npm`,
 * which is the layout of a Node installed from the Windows MSI or the official
 * tarball. GitHub's `actions/setup-node` on Linux runs node from
 * `/opt/hostedtoolcache/node/<version>/x64/bin/node`, where npm's library lives
 * under `lib/node_modules/npm` instead — so the probe missed, the fallback became
 * a bare `npx`, and that is unresolvable without a shell on Windows and a PATH hop
 * everywhere else. CI caught it as two red assertions; the same install shape
 * would have made the gate spawn the wrong thing on a developer's Linux box.
 *
 * Searches the same way `findTsxCli` does — one directory at a time, both the
 * plain and the `lib/` npm layout — because "npm sits next to node" is an
 * assumption about how Node was packaged, not a guarantee.
 */
function findNpxCli() {
  let dir = path.dirname(process.execPath);
  for (let depth = 0; depth < TSX_SEARCH_DEPTH; depth += 1) {
    for (const npmRoot of ['node_modules', path.join('lib', 'node_modules')]) {
      const candidate = path.join(dir, npmRoot, 'npm', 'bin', 'npx-cli.js');
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * How deep to look for a hoisted `node_modules/tsx` before giving up.
 *
 * Four is enough for the layouts that actually occur — `<repo>/node_modules`,
 * `<repo>/src/npm-package/node_modules`, a git worktree's shared parent, and one
 * level of monorepo nesting — without turning a miss into an unbounded walk up to
 * the filesystem root.
 */
const TSX_SEARCH_DEPTH = 4;

/**
 * The nearest installed `tsx` CLI entry, or null.
 *
 * #779: every TypeScript gate used to be launched as `npx -y tsx <entry> --run`, and
 * `npx -y` re-resolves where the package lives on EVERY call. Measured on this
 * machine: `npx -y tsx --version` takes 4547-5811 ms while `node <tsx-cli> --version`
 * takes 787-821 ms. That is ~4 s of pure package-resolution paid once per TS gate,
 * and `xp-gate check --all` runs several — which is how a one-file project reached
 * 117 s (the /tmp measurement in the governance review).
 *
 * Searching upward matters because the CLI is normally invoked from a CONSUMER
 * project whose `node_modules` lives at the project root, while the gate module is
 * resolved from the xp-gate install.
 *
 * @param {string} [cwd] directory to start from; defaults to process.cwd()
 * @returns {string|null}
 */
function findTsxCli(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  for (let depth = 0; depth < TSX_SEARCH_DEPTH; depth += 1) {
    const candidate = path.join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * The executable + argv for running one TypeScript gate module.
 *
 * Prefers `node <tsx-cli> <args>`: no shim, no shell, no network, and no repeated
 * package resolution. Falls back to npm's own `npx-cli.js` (still under the current
 * node binary, still shell-free) only when no tsx is installed — the shape
 * `resolveNpxInvocation` already guarantees.
 *
 * A `tsx/` directory with no `dist/cli.mjs` is treated as "not installed": a
 * half-written install would otherwise be spawned and fail with a message about
 * missing files, which reads like a gate defect rather than an install one.
 *
 * @param {string[]} args tsx argv (entry path, then the gate's own flags)
 * @param {{cwd?: string}} [opts]
 * @returns {{command: string, args: string[], viaNpx: boolean}}
 */
function resolveTsxInvocation(args, opts = {}) {
  const tsxCli = findTsxCli(opts.cwd);
  if (tsxCli) return { command: process.execPath, args: [tsxCli, ...args], viaNpx: false };
  const [command, argv] = resolveNpxInvocation(['-y', 'tsx', ...args]);
  return { command, args: argv, viaNpx: true };
}

/**
 * A project-local gate variant, if the project declares one.
 *
 * `<consumer cwd>/githooks/gates/gate-<n>-<name>.sh` is where a PROJECT puts its
 * own variant of a gate: the hyphenated name is the point, because it lets one
 * project keep several variants where a flat `gate-<n>.sh` cannot express the
 * choice (#672, restored by 7b43666a). `xp-gate init` never creates that
 * directory, so a stock project simply falls through to the built-in
 * implementation and nothing changes for it.
 *
 * This is deliberately NOT the same as `<project>/src/gates/<gate>.ts`, which
 * `findTsGateEntry` refuses to read (#672): that path let the party being
 * checked supply the implementation, so `process.exit(0)` passed every gate.
 * Declaring a variant under `githooks/gates/` is an explicit, named opt-in;
 * dropping a file into `src/gates/` is not.
 *
 * @param {string} gateModule e.g. 'gate-9'
 * @param {string} cwd project root to search
 * @returns {string|null}
 */
function findConsumerGateVariant(gateModule, cwd) {
  const gateNum = gateModule.replace('gate-', '');
  // Strictly the project's own declaration. `resolveGateScript` additionally
  // probes the flat `githooks/gate-<n>.sh` and the global install
  // (~/.config/xp-gate/adapters/); treating either as "the project declared a
  // variant" would hand every gate to whichever bash copy happens to be
  // installed -- on a machine with a global install that is *always*. A variant
  // is a file the project deliberately named, so only `githooks/gates/` counts.
  const gatesDir = path.join(cwd, 'githooks', 'gates');
  const declared = matchGateFileIn(gatesDir, gateNum);
  return declared ? path.join(gatesDir, declared) : null;
}

/**
 * Which implementation runs this gate: a project-declared variant, the built-in
 * TypeScript module, or a bash fallback.
 *
 * Split out of `runTsGate` so that function stays about running the gate. The
 * precedence is a contract with two sides -- `githooks/gates/` is the project's
 * opt-in, and the built-in module must remain reachable when nobody opted in --
 * so it is named here rather than inlined in the runner.
 *
 * @returns {{kind: 'variant', script: string} | {kind: 'module', entry: string} | {kind: 'fallback', script: string} | {kind: 'none'}}
 */
function resolveGateImplementation(gateModule, targetCwd) {
  const variant = findConsumerGateVariant(gateModule, targetCwd);
  if (variant) return { kind: 'variant', script: variant };

  const entry = findTsGateEntry(gateModule);
  if (entry) return { kind: 'module', entry };

  const script = resolveGateScript(gateModule.replace('gate-', ''), targetCwd);
  return script ? { kind: 'fallback', script } : { kind: 'none' };
}

function runTsGate(gateModule, targetPath, opts = {}) {
  const targetCwd = resolveGateCwd(targetPath);
  const impl = resolveGateImplementation(gateModule, targetCwd);

  if (impl.kind === 'variant' || impl.kind === 'fallback') {
    return runGateAdapter(impl.script, targetCwd, opts);
  }
  if (impl.kind === 'none') {
    // #618: nothing ran. Before this, the function fell through to `return 0`
    // and the --all summary counted the gate as passed.
    console.log(`Gate ${gateModule}: TypeScript module not found and no bash fallback available.`);
    console.log(`⏭️  SKIPPED - Gate ${gateModule} did not run (no module, no bash fallback)`);
    return GATE_NOT_RUN;
  }

  const args = [impl.entry, '--run'];
  if (targetPath) args.push('--cwd', targetPath);

  // spawnSync reports a spawn failure (npx missing) on `error`, throws only on a
  // malformed argv, and reports a killed child (timeout, signal) as a null status.
  // All three mean "the gate did not report a verdict", which must not be read as
  // success: a gate that never ran is not a gate that passed.
  //
  // spawnSync reports a spawn failure (npx missing) on `error`, throws only on a
  // malformed argv, and reports a killed child (timeout, signal) as a null status.
  // All three mean "the gate did not report a verdict", which must not be read as
  // success: a gate that never ran is not a gate that passed.
  // #779: node + tsx's own CLI, not `npx -y tsx`. Same no-shell guarantee, no
  // per-gate package re-resolution (~4 s saved per TS gate).
  const { command, args: commandArgs, viaNpx } = resolveTsxInvocation(args, { cwd: targetCwd });
  try {
    const result = spawnSync(command, commandArgs, {
      stdio: 'inherit',
      cwd: targetCwd,
      timeout: TS_GATE_TIMEOUT_MS,
    });
    if (result.error) {
      console.error(`Gate ${gateModule}: failed to run tsx (${viaNpx ? 'npx fallback' : 'local cli'}): ${result.error.message}`);
      return 1;
    }
    return result.status === null ? 1 : result.status;
  } catch (err) {
    console.error(`Gate ${gateModule}: could not spawn tsx (${viaNpx ? 'npx fallback' : 'local cli'}): ${err.message}`);
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
  ];
  // #672: there used to be a fourth candidate, `process.cwd()/src/gates/<gate>.ts`.
  // It never won in this repo -- the developer layouts above always matched first --
  // so every test here stayed green while the candidate was live. In an npm INSTALL
  // the first three do not exist, and it became the gate implementation: a project
  // that happened to have `src/gates/gate-9.ts` could ship `process.exit(0)` and
  // pass every gate, security ones included. A gate whose implementation is chosen
  // by the party being checked is not a gate.
  //
  // The implementation travels with the package. When none of the three are present
  // the gate falls back to the bash adapter (or SKIPs), which is the designed path.
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
      const args = buildJscpdArgs({ targetPath });
      const outcome = runJscpd(args, targetPath);
      // A run that examined nothing is NOT a pass. Say so with a reason, per the
      // SKIP contract both AGENTS.md files state: "not checked" must never be
      // recordable as "passed". Returning GATE_NOT_RUN is how the rest of this file
      // reports the same condition, so the caller records a skip rather than a
      // verdict it never computed.
      if (outcome === 'no_files') {
        process.stderr.write(
          '[gate-2] SKIP: jscpd analysed no files, so "Found 0 clones" is not a verdict. '
          + 'Check --ignore / --format / --pattern, or whether the target holds any '
          + 'source this tool recognises.\n',
        );
        return GATE_NOT_RUN;
      }
      return undefined;
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
  // Numbering follows the HOOK, which is where gates actually execute (#677).
  // These two were swapped here: the CLI called 9 "SAST" and 10 "Build Integrity"
  // while the hook runs 9=Build integrity and 10=Semgrep SAST. A user reading
  // "❌ BLOCKED - Gate 9: Build integrity check failed" in their commit output and
  // then running `xp-gate check --gates 9` got semgrep -- a different gate, reported
  // green. The hook is the majority implementation and the one the error message
  // names, so its numbering wins.
  '9': {
    name: 'Build Integrity',
    description: 'TypeScript compilation, npm pack, and import validation',
    aliases: ['build', '9'],
    preCommitOnly: true,
    reason: 'Build integrity checks require language detection and build tool context',
  },
  '10': {
    name: 'SAST Security',
    description: 'semgrep static application security testing',
    aliases: ['sast', 'semgrep', '10'],
    run: (targetPath) => {
      return runTsGate('gate-9', targetPath);
    },
  },
  '11': {
    name: 'Sprint Flow Enforcement',
    description: 'Sprint state and delphi-review validation',
    aliases: ['sprint', '11'],
    preCommitOnly: true,
    reason: 'Requires sprint state (.sprint-state/) and git branch context',
  },
  // Gates 12 and 13 block commits in the hook but were absent here entirely, so
  // `xp-gate check --gates 12` answered "Unknown gate(s)" for a gate that had just
  // blocked the user (#677). Registered with an explicit reason rather than
  // pretending to re-implement them: both need the staged-diff and per-language
  // build context the hook assembles, and a half-correct reimplementation that
  // answered PASS would be worse than saying so.
  '12': {
    name: 'File Hygiene',
    description: 'conflict markers (blocking) + YAML/JSON syntax (blocking) + whitespace warnings',
    aliases: ['hygiene', 'file-hygiene', '12'],
    preCommitOnly: true,
    reason: 'File hygiene inspects the staged diff, which only exists inside the hook',
  },
  '12b': {
    name: 'Mirror Parity',
    description: 'canonical hook sources match their published src/npm-package mirrors (#654)',
    aliases: ['mirror', 'mirror-parity', '12b'],
    preCommitOnly: true,
    reason: 'Mirror parity compares the staged pair of files against their canonical copies',
  },
  '12c': {
    name: 'Probe Discipline',
    description: 'no gate answers "is this tool installed?" by querying a registry',
    aliases: ['probe', 'probe-discipline', '12c'],
    preCommitOnly: true,
    reason: 'Probe discipline scans hook sources in the staged change set',
  },
  '13': {
    name: 'Compiler Strictness',
    description: 'gcc/g++ -Wall -Wextra, javac -Xlint, Maven/Gradle warnings on changed files',
    aliases: ['compiler', 'strictness', '13'],
    preCommitOnly: true,
    reason: 'Compiler strictness needs the changed-file set and a discovered toolchain',
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

/**
 * The duplicate-scan ignore set for a project that has no jscpd.conf.json.
 *
 * jscpd 4.x takes --ignore as a GLOB (star-star/node_modules/star-star), not a
 * first version of this function copied the regex from githooks/lib/jscpd-run.sh
 * and passed it straight through, which silently matched nothing: measured on a
 * fixture whose .xp-gate/reports copy was byte-identical to a source file,
 * --ignore with the regex reported 3 clones (copy included) while a glob form
 * reported 2 (copy excluded). A gate that prints an ignore flag and ignores
 * nothing is worse than one with no flag.
 *
 * Written without literal star-slash sequences on purpose: inside a block
 * comment a glob like star-star/name/star-star closes the comment early and the
 * rest of the file is parsed as code (measured: "node_modules is not defined" at
 * module load).
 *
 * The directory list is kept here in glob form on purpose: the bash side uses a
 * regex for a different consumer (its own file-list filter), so the two are not
 * interchangeable and must not be copy-pasted between each other. The names,
 * though, are the same set.
 */
function jscpdDefaultIgnorePatterns() {
  return [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/target/**',
    '**/coverage/**',
    '**/out/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/vendor/**',
    '**/.xp-gate/**',
    // The build mirror. Byte-identical to githooks/, plugins/ and skills/ by
    // construction, so `jscpd` comparing it to them reports the mirror as
    // duplicated code -- 28 s per run and a FAIL nobody can act on (measured
    // 2026-11-24). Mirror drift has its own gate (12b).
    '**/src/npm-package/**',
    '**/*.log',
    '**/*.txt',
    '**/*.yaml',
    '**/*.yml',
    '**/*.md',
  ].join(',');
}

/**
 * Resolve jscpd's JS entry point without assuming a filename.
 *
 * Two defects are fixed here at once (#853):
 *
 * 1. **Doubled `node_modules`.** Roots were probed as
 *    `path.join(root, 'node_modules', 'jscpd', ...)`, but a global npm prefix
 *    already ends in `node_modules`, so the probe became
 *    `<prefix>/node_modules/node_modules/jscpd`. `hasNodeModules()` decides per
 *    root whether to append the segment.
 *
 * 2. **Hardcoded `bin/jscpd`.** jscpd 5.x declares its entry as
 *    `{"jscpd": "./run-jscpd.js"}` and ships no `bin/jscpd` at all. The bin field
 *    is now read from the installed package.json, so an upstream rename cannot
 *    silently disable the gate again -- which is precisely how 5.x broke it.
 *
 * @param {{searchRoots?: Array<string|undefined>}} [opts]
 * @returns {string|null} absolute path to jscpd's JS entry, or null when absent
 */
function findJscpdEntry(opts = {}) {
  const roots = (opts.searchRoots || []).filter((r) => typeof r === 'string' && r.length > 0);
  for (const root of roots) {
    const candidate = jscpdEntryUnder(root);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * Look for an installed jscpd beneath one root, treating the root as either a
 * project directory (whose `node_modules` we must enter) or a node_modules
 * directory already.
 *
 * @param {string} root
 * @returns {string|null}
 */
function jscpdEntryUnder(root) {
  const bases = [path.join(root, 'node_modules')];
  // A global npm prefix (`<...>/npm/node_modules`) is itself a node_modules dir.
  if (path.basename(path.resolve(root)) === 'node_modules') bases.unshift(root);
  // POSIX global installs put packages in `<prefix>/lib/node_modules`, while
  // `path.dirname(process.execPath)` is `<prefix>/bin`. Without this, #853's fix
  // would work on Windows and leave the same bug on every Linux/macOS install.
  bases.push(path.join(root, 'lib', 'node_modules'));
  for (const base of bases) {
    const entry = jscpdEntryIn(path.join(base, 'jscpd'));
    if (entry) return entry;
  }
  return null;
}

/**
 * Read `package.json`'s bin field from `packageDir` and return the entry that
 * actually exists on disk, or null when the package is absent or half-written.
 *
 * @param {string} packageDir
 * @returns {string|null}
 */
function jscpdEntryIn(packageDir) {
  const pkgJson = path.join(packageDir, 'package.json');
  let bin;
  try {
    bin = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).bin;
  } catch {
    // No package.json, unreadable, or invalid JSON: not an installed package.
    return null;
  }
  const rel = typeof bin === 'string' ? bin : bin && (bin.jscpd || Object.values(bin)[0]);
  if (!rel) return null;
  const entry = path.join(packageDir, rel);
  return fs.existsSync(entry) ? entry : null;
}

/**
 * Default duplicate-ratio ceiling for Gate 2.
 *
 * Must match the `code-duplication` principle rule's threshold. Two gates judging
 * "how much duplication is too much" with different numbers teach the user that
 * the gates disagree, and a user who sees Gate 4 fail while Gate 2 passes
 * concludes the gates are unreliable.
 */
const JSCPD_THRESHOLD = 15;

/**
 * Build the jscpd argv for Gate 2.
 *
 * Extracted from the gate's `run` so the threshold decision is testable without
 * spawning jscpd. The threshold is the part that was missing: jscpd returns 0
 * regardless of findings when no `--threshold` is given, so forwarding its exit
 * code made Gate 2 unconditionally pass. Measured on a fixture with 66.7%
 * duplication: `jscpd .` exit 0, `jscpd . --threshold 5` exit 1.
 *
 * @param {{targetPath?: string}} opts
 * @returns {string[]}
 */
function buildJscpdArgs(opts = {}) {
  const targetPath = opts.targetPath;
  const jscpdConfig = findJscpdConfig(targetPath);
  // The scan root is '.' whenever we are running inside the target.
  //
  // jscpd 4.x does not apply its glob ignore rules to an ABSOLUTE scan path:
  // measured on a fixture with three byte-identical files, one of them under
  // .xp-gate/, `jscpd <abs-path> --ignore "**/.xp-gate/**,..."` reported 0
  // clones while `jscpd . --ignore <same>` reported 2 (the copy excluded, the
  // real duplicate kept). Passing '.' and running with cwd = target keeps both
  // the ignore rules and the discovery working.
  const scanRoot = !targetPath || path.resolve(targetPath) === path.resolve(process.cwd()) ? '.' : targetPath;
  const args = [scanRoot];
  // A config is passed only when jscpd can actually parse it. Measured on
  // jscpd 5.4.3: `--config <corrupt>` exits 1 with "key must be a string at line 1
  // column 3", which the gate forwards as a verdict -- so a typo in the project's
  // config would be reported as "duplicate code found". An unreadable config is
  // treated as absent, and the default threshold still applies.
  const parsedConfig = jscpdConfig ? readJscpdConfig(jscpdConfig) : null;
  if (parsedConfig) {
    args.push('--config', jscpdConfig);
    // A config that declares its own `threshold` owns the decision. Passing ours
    // as well would override the project's number -- the same config-vs-CLI
    // conflict that already cost the ignore list its entries.
    if (!isFiniteNumber(parsedConfig.threshold)) args.push('--threshold', String(JSCPD_THRESHOLD));
    return args;
  }
  if (jscpdConfig) {
    // The config exists but cannot be used. Saying so is not optional: silently
    // dropping the project's ignore/min-tokens rules changes what gets scanned,
    // and the operator would have no way to tell that from a real result. The
    // gate still runs (fail-open on the config, fail-closed on the threshold).
    process.stderr.write(
      `[gate-2] ignoring unreadable jscpd config ${jscpdConfig}; `
      + `using the built-in ignore set and --threshold ${JSCPD_THRESHOLD}\n`,
    );
  }
  // The ignore set is passed ONLY when the project has no config of its own.
  //
  // jscpd's --ignore is a REGEX while jscpd.conf.json's ignore is GLOB. Passing
  // both does not merge them -- the CLI value replaces the config's list, so the
  // scan lost "**/node_modules/**" and "**/.worktrees/**" and started walking
  // .worktrees/sprint-*/plugins/opencode/node_modules (measured: 300 s timeout,
  // down from 49 s, with the run still failing). The config is authoritative
  // when it exists; the built-in set is a fallback for projects without one.
  const ignore = jscpdDefaultIgnorePatterns();
  if (ignore) args.push('--ignore', ignore);
  args.push('--threshold', String(JSCPD_THRESHOLD));
  return args;
}

/**
 * Parse a jscpd config file.
 *
 * @param {string} configPath
 * @returns {object|null} the parsed object, or null when unreadable or invalid
 */
function readJscpdConfig(configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The npm global prefixes worth probing for an installed tool.
 *
 * Built conditionally because `path.join('', 'npm')` yields the RELATIVE path
 * `npm`, which `findJscpdEntry` would then resolve against the current directory:
 * an unset APPDATA/HOME would silently point the search at `./npm` and
 * `./.npm-global`. A candidate is only included when its base variable exists.
 *
 * @param {{binDir: string, appData?: string, home?: string}} env
 * @returns {string[]} absolute prefixes, most likely first
 */
function buildGlobalPrefixes(env) {
  const prefixes = [env.binDir];
  // A POSIX global prefix puts the binary in <prefix>/bin, so its parent is the
  // prefix packages hang off. Walking up avoids hardcoding "/usr".
  if (env.binDir) prefixes.push(path.dirname(env.binDir));
  if (env.appData) prefixes.push(path.join(env.appData, 'npm'));
  if (env.home) prefixes.push(path.join(env.home, '.npm-global'));
  // Only absolute results are usable as prefixes.
  return prefixes.filter((p) => typeof p === 'string' && p.length > 0 && path.isAbsolute(p));
}

/**
 * What a finished jscpd run tells us, as one of four values.
 *
 * `no_files` is the one that did not exist before #855, and it is the reason this
 * function exists at all. jscpd answers "Found 0 clones" for a run that examined
 * nothing and for a run that examined the change set and found it clean -- the two
 * are only the same statement if something was actually read. It says so itself, on
 * the stream, and exits 0 anyway:
 *
 *   Warning: jscpd analyzed no files: check the paths and the --format, --ignore
 *   and --pattern filters
 *   Found 0 clones.
 *
 * Measured on a fixture below jscpd's min-tokens floor: `xp-gate check 2` printed
 * "No duplicates found.", a table with `Files analyzed: 0`, and exited 0. A gate
 * that examined nothing was indistinguishable from a passing one.
 *
 * "error" is wrong here (jscpd did not fail), "clean" is wrong (nothing was read),
 * and "duplicates" is wrong. Hence a fourth value.
 *
 * The shell hook has classified this way since gate-2-no-files.test.bats landed
 * (`classify_jscpd_run` in githooks/lib/jscpd-run.sh); the CLI path had no
 * equivalent, which is how #855 survived its fix.
 *
 * @param {number|null} exitCode jscpd's exit status
 * @param {string} output the combined stdout+stderr
 * @returns {'error'|'no_files'|'duplicates'|'clean'}
 */
function classifyJscpdRun(exitCode, output) {
  const text = typeof output === 'string' ? output : '';
  // A failed run is the more specific fact, so it is checked first: reporting it as
  // no_files would hide a genuine tool failure behind a plausible excuse.
  if (typeof exitCode !== 'number' || exitCode !== 0) return 'error';

  const clones = text.match(/Found (\d+) (?:clones?|duplicates?)/i);
  if (clones) {
    // A clone count above zero is a finding whatever else the run said.
    if (Number.parseInt(clones[1], 10) > 0) return 'duplicates';
    // Zero clones is a verdict only when files were read.
    if (/analyzed no files/i.test(text)) return 'no_files';
    const scanned = text.match(/\|\s*Total:\s*\|\s*(\d+)\s*\|/i);
    if (scanned && Number.parseInt(scanned[1], 10) === 0) return 'no_files';
    return 'clean';
  }

  // No clone line at all. A report with any content other than a bare timing is
  // still treated as a scan that happened -- turning every unfamiliar future jscpd
  // format into a SKIP would disable the gate for everyone.
  const meaningful = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^time:\s/i.test(line));
  if (meaningful.length === 0) return 'no_files';
  return 'clean';
}

function runJscpd(args, targetPath) {
  // Invoke jscpd's JS entry through `node` rather than going through .bin/.
  //
  // Two dead ends, both measured on Windows:
  //   execFileSync with shell:true  -> the ignore pattern's `|` became a pipe and
  //     the child died with "'dist' is not recognized ...", while `check 2` still
  //     exited 0 -- a crashed gate reading as a fast clean pass.
  //   execFileSync without shell     -> EINVAL on jscpd.cmd (.cmd needs a shell) and
  //     ENOENT on the extensionless jscpd (a shell script).
  // Running the package's real entry point sidesteps both: argv goes to node
  // untouched, no shell parses anything, and the tool is the one already installed.
  // Where jscpd actually lives, in the order that avoids a shell entirely:
  //   1. the project under check
  //   2. this package own dependency tree
  //   3. the global install tree
  //
  // The global trees are passed as PREFIXES, not as `.../node_modules` paths,
  // because a global npm prefix already contains `node_modules`. Treating the two
  // the same is #853: the old code appended `node_modules/jscpd/bin/jscpd` to an
  // already-`node_modules`-terminated root, probing
  // `<prefix>/node_modules/node_modules/jscpd/bin/jscpd`, which can never exist.
  // `entry` was therefore always undefined and every lookup fell through to `npx`,
  // which on Windows reported `spawnSync npx ENOENT` -- a working tool reported as
  // missing, with an exit code indistinguishable from "duplicate code found".
  //
  // process.execPath is the node BINARY location, not the npm global prefix; both
  // are probed along with the APPDATA npm tree, because a global package lives in
  // a directory that varies by platform and by install method.
  // Each entry is a PREFIX, not a node_modules directory: findJscpdEntry probes
  // `<prefix>/node_modules`, `<prefix>/lib/node_modules` (POSIX global installs)
  // and, when the prefix is itself named node_modules, the prefix directly.
  const nodeBinDir = path.dirname(process.execPath);
  const globalPrefixes = buildGlobalPrefixes({
    binDir: nodeBinDir,
    appData: process.env.APPDATA,
    home: process.env.USERPROFILE || process.env.HOME,
  });
  const entry = findJscpdEntry({ searchRoots: [targetPath, process.cwd(), ...globalPrefixes] });
  let lastErr = null;
  // Third fallback is deliberately `--no-install`: a global jscpd is on PATH on the
  // dev machine (/c/Users/think/AppData/Roaming/npm/jscpd) but `npx` here was
  // reported ENOENT when no local node_modules existed -- a tool that IS installed
  // reported as missing. The bare-name attempt covers PATH; npx covers a global npm
  // prefix not on PATH; neither installs anything.
  const attempts = entry
    ? [[process.execPath, [entry, ...args]]]
    : [
        [process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd', args],
        ['jscpd', args],
        ['npx', ['--no-install', 'jscpd', ...args]],
      ];
  for (const [cmd, cmdArgs] of attempts) {
    try {
      // The stream is CAPTURED and replayed rather than inherited, because the
      // verdict depends on what jscpd said. With `stdio: 'inherit'` the output went
      // straight to the terminal, so the gate could not tell a clean scan from one
      // that examined nothing -- #855. Replaying it immediately keeps the operator's
      // view identical to before.
      const result = spawnSync(cmd, cmdArgs, {
        cwd: targetPath || process.cwd(),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.error) throw result.error;
      const outcome = classifyJscpdRun(result.status, `${result.stdout || ''}\n${result.stderr || ''}`);
      if (result.status === 0) return outcome;
      lastErr = new Error(`jscpd exited ${result.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('jscpd not available');
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
 * Config filenames jscpd itself reads, in the order it prefers them.
 *
 * Only `jscpd.conf.json` used to be looked for. Measured on jscpd 5.4.3 against a
 * fixture at 66.7% duplication, a project setting `{"threshold": 90}` in
 * `.jscpd.json`:
 *   `jscpd .`                      -> exit 0 (project's 90 respected)
 *   `jscpd . --threshold 15`       -> exit 1 (our CLI value overrode it)
 * So a project that declared its own threshold in `.jscpd.json` had the gate
 * impose 15 instead -- taking the decision away from the project that made it.
 * `.jscpdrc` is NOT read by jscpd (verified: still exit 0), so it is excluded
 * rather than pretended to work.
 */
const JSCPD_CONFIG_FILENAMES = ['jscpd.conf.json', '.jscpd.json'];

/**
 * Locate a jscpd config the tool will actually honour.
 *
 * Discovery follows ONE root, chosen by whether the caller named a target:
 *
 *  - An explicit target means that target: its config decides. Falling back to the
 *    working directory would let `xp-gate check 2 /other/repo` judge that repo by
 *    THIS repo's ignore list and threshold. Measured before this rule existed:
 *    with only this repo holding a jscpd.conf.json, a target with no config of its
 *    own still received `--config <this repo>/jscpd.conf.json`.
 *  - No target means the working directory, which is the tree the scan covers.
 *
 * Every supported filename is tried in the chosen root before giving up; trying
 * one name across both roots first let a `jscpd.conf.json` in the cwd shadow a
 * `.jscpd.json` in the project being checked.
 *
 * @param {string} [basePath] the explicit target, if the caller gave one
 * @returns {string|null}
 */
function findJscpdConfig(basePath) {
  const root = basePath || process.cwd();
  for (const name of JSCPD_CONFIG_FILENAMES) {
    const candidate = path.join(root, name);
    if (isRegularFile(candidate)) return candidate;
  }
  return null;
}

/**
 * True only for an existing REGULAR FILE.
 *
 * `fs.existsSync` is also true for a directory, and a directory named
 * `.jscpd.json` would be handed to jscpd as `--config <dir>`, failing the gate for
 * a reason unrelated to duplication.
 *
 * @param {string} candidate
 * @returns {boolean}
 */
function isRegularFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
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

/**
 * Report a gate that only runs during `git commit`, and return the sentinel.
 *
 * #778: returns GATE_NOT_RUN, NOT 0. The inline version of this branch used to
 * `return 0` while the branch 340 lines above returns GATE_NOT_RUN for the same
 * meaning ("nothing ran"). bin/xp-gate.js maps the sentinel to exit 2 precisely
 * so a gate that never executed cannot exit like a gate that ran clean -- and
 * that branch walked straight past the guarantee for seven of the fourteen
 * pre-commit gates. One file, two opposite answers to one question.
 *
 * Callers that legitimately treat "not run" as success (check.js, for a gate
 * with nothing to analyse) already coerce the sentinel explicitly; making the
 * coercion visible at each call site is the point, not an inconvenience.
 */
function reportPreCommitOnly(gateId, gate) {
  console.log(`━━━ Gate ${gateId}: ${gate.name} ━━━`);
  console.log(`⏭️  SKIPPED - ${gate.reason}`);
  console.log('   This gate runs automatically during git commit.');
  console.log('   Run: git commit to trigger all gates.');
  return GATE_NOT_RUN;
}

async function runGate(gateId, targetPath, opts = {}) {
  const gate = GATE_REGISTRY[String(gateId)];
  if (!gate) {
    console.error(`Unknown gate: ${gateId}`);
    console.error(`Available gates: ${Object.keys(GATE_REGISTRY).join(', ')}`);
    return 1;
  }

  if (gate.preCommitOnly) {
    return reportPreCommitOnly(gateId, gate);
  }

  if (gate.run) {
    console.log(`━━━ Gate ${gateId}: ${gate.name} ━━━`);
    return invokeGateHandler(gateId, gate, targetPath, opts);
  }

  console.error(`Gate ${gateId}: ${gate.name} — no execution handler available`);
  return 1;
}

/**
 * Call a gate's execution handler and normalise its verdict to a number.
 *
 * Extracted from runGate(): that function is a dispatch (unknown gate →
 * pre-commit-only gate → handler → no handler) and this is the one branch with
 * real logic in it, so keeping both in one body pushed it past the 50-line limit
 * the Boy Scout rule enforces on a file it touches.
 *
 * The verdict rules, unchanged from the inline version:
 *   - a promise is awaited (a rejection surfaces in the catch below);
 *   - GATE_NOT_RUN passes through untouched (#778) so "nothing ran" never
 *     exits like "ran clean";
 *   - a sync handler's number is propagated (#563) -- manufacturing 0 for gates
 *     3/7/8/9 made `xp-gate check` unable to report a failure;
 *   - a handler that returns nothing counts as pass, because gate 2's failure
 *     signal is the throw from execFileSync, not a return value.
 */
async function invokeGateHandler(gateId, gate, targetPath, opts) {
  try {
    // #589: pass the scope through so a handler that shells out to a fragment can
    // resolve its file list from the tree under --all. Handlers that ignore the
    // second argument are unaffected.
    const result = gate.run(targetPath, opts);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    if (result === GATE_NOT_RUN) return GATE_NOT_RUN;
    return typeof result === 'number' ? result : 0;
  } catch (err) {
    // Covers a synchronous throw AND a rejection from the awaited handler.
    console.error(` Gate ${gateId} FAILED: ${err.message}`);
    return 1;
  }
}

module.exports = { findConsumerGateVariant, GATE_REGISTRY, GATE_NOT_RUN, classifyJscpdRun, getGateInfo, getAllGates, runGate, resolveAlias, getAliases, runGateAdapter, findTsGateEntry, resolveGateScript, resolveTsxInvocation, findTsxCli, findJscpdEntry, buildJscpdArgs, JSCPD_THRESHOLD, buildGlobalPrefixes, SOURCE_FILE_EXTENSIONS, resolveAllModeChangedFiles, describeEmptyChangedFiles, describeChangedFilesScope,
  // AC-670-03 asserts the --all preamble END-TO-END: that an all-mode run hands
  // the security gates a non-empty file population sourced from the list file and
  // sets GATE_SCOPE="all". With these unexported, the case could only take its
  // `skip "buildPreamble is not exported"` branch, so the end-to-end check it was
  // written for never ran -- and the unit tests it defers to assert the pieces
  // separately, which is precisely the seam this case covers. Both are pure
  // string builders with no side effects, so exporting them costs nothing.
  buildPreamble, buildFileSourceLines };
