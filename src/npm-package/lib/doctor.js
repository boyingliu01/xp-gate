const fs = require('fs');
const path = require('path');
const { execSync, execFileSync, spawnSync } = require('child_process');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const sharedPaths = require('./shared-paths.js');
const { detectPlatform, getTemplateDir } = sharedPaths;

// #599: the filesystem roots below are DERIVED FROM process.env.HOME, so they
// must not be captured at require() time. doctor.js is routinely loaded by a
// test run BEFORE that run sets HOME -- doctor.test.js loads detect-deps.js
// (which loads shared-paths.js) in beforeAll, before any test assigns HOME --
// and a require-time capture froze CONFIG_FILE to the REAL home directory. That
// made `doctor` report `Config file: Not found` for fixtures that had in fact
// written the config, and `--fix` returned 1 on a healthy installation.
//
// These are therefore read through the module at each use, not destructured.
const HOME_DIR = () => sharedPaths.HOME_DIR;
const CONFIG_FILE = () => sharedPaths.CONFIG_FILE;
const GLOBAL_HOOKS_DIR = () => sharedPaths.GLOBAL_HOOKS_DIR;
const GLOBAL_ADAPTERS_DIR = () => sharedPaths.GLOBAL_ADAPTERS_DIR;
const { checkUpgrade, formatUpgradeMsg } = require('./check-version.js');
const { GATE_CLI_TOOLS, checkCliTool, getToolInstallCmd, checkBash } = require('./detect-deps.js');
// #505: the single source of truth for module resolution order. The hook reads a
// generated shell projection of this same module.
const { RESOLUTION_ORDER } = require('./hook-module-resolution.js');
const { inspectHookFile } = require('./hook-health.js');

/**
 * Files above this size get a `bash -n` probe in addition to the CRLF scan.
 * Real xp-gate hooks are 40 KB (pre-push) to 190 KB (pre-commit); test fixtures
 * and stubs are a few hundred bytes. 4 KB separates them comfortably.
 */
const PARSE_CHECK_MIN_BYTES = 4096;
const {
  diagnoseTuiRegistration, diagnoseInstalledSkills,
  fixTuiRegistration, ensureTuiRegistration, readTuiJson,
} = require('./doctor-tui.js');

// npm package source dir (template hooks/adapters)
const PKG_DIR = path.dirname(__dirname);

/**
 * Read the package version from the installed package.json.
 * @returns {string|null}
 */
function getPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Signature strings used to verify file ownership.
 */
const SIGNATURES = {
  'pre-commit': 'OpenCode Quality Gates - Pre-Commit Hook',
  'pre-push': 'Pre-push Hook — 8 gates:',
  'post-merge': 'XP-Gate VERSION sync hook',
  'adapter-common.sh': 'detect_project_lang()'
};

/**
 * Hard timeout for all execSync calls in doctor diagnostics.
 * Prevents hanging subprocesses (e.g., missing CLI tools on Windows)
 * from blocking the entire doctor run.
 * Reduced from 3000ms to 1500ms — Windows cmd.exe spawn is slow;
 * if a tool can't respond in 1.5s it's effectively unavailable.
 */
const EXEC_TIMEOUT_MS = 1500;

/**
 * Global timeout for the entire diagnosis flow.
 * Prevents doctor from running longer than this even if individual
 * checks haven't completed (e.g., network timeouts stacking up).
 */
const GLOBAL_DIAGNOSIS_TIMEOUT_MS = 10000;

/**
 * Fixed attribution text for the WorkBuddy-desktop sandbox restriction (#525).
 *
 * In a WorkBuddy desktop session, a node process's *synchronous* child-process
 * calls (spawnSync/execSync) always fail with EBUSY, while async spawn works;
 * external terminals, CI and git hook chains are unaffected. The interception
 * layer belongs to the host application, not to xp-gate or any antivirus, so
 * the only correct response is to name it and point at the working channels.
 */
const EBUSY_ATTRIBUTION = 'sync spawn blocked by host sandbox (EBUSY) -- likely WorkBuddy desktop session; '
  + 'use async child_process.spawn in-session, verify via CI / external terminal / git hook chain. '
  + 'NOT a code or antivirus problem.';

/**
 * Execute a command with a hard timeout using async exec.
 * Returns { stdout, stderr } on success, null on failure/timeout.
 */
/**
 * Dedup scope: one attribution line per *diagnosis* is a diagnosis; one per
 * check is noise. `diagnoseAsync` resets this, so a long-lived host process
 * (or a --fix pre/post double run) still attributes each report round (#525 R1).
 */
let ebusyAttributionShown = false;

/**
 * Shared EBUSY attribution printer for BOTH spawn families (#525 R1).
 *
 * Note the asymmetry the platform sandbox exhibits: synchronous child-process
 * calls (execSync/spawnSync) always fail with EBUSY in a WorkBuddy session,
 * while async spawn/exec currently pass. The sync call sites below are where
 * the false reds actually come from; the async branch in execWithTimeout is
 * kept as a defense-in-depth no-op today -- if the sandbox ever widens its
 * interception, the attribution is already wired.
 */
function noteSandboxAttribution(err) {
  if (err && err.code === 'EBUSY' && !ebusyAttributionShown) {
    ebusyAttributionShown = true;
    console.error(`  ⚠ ${EBUSY_ATTRIBUTION}`);
  }
}

async function execWithTimeout(cmd, opts = {}) {
  // Win32 false-negative guard. Under cmd.exe (exec's shell), a spawned probe
  // can exit 0 while its stdout never reaches us — measured on this machine:
  // `node --version` returns exit 0 with an EMPTY stream when many spawns are
  // in flight at once (doctor's parallel fan-out), while the same command
  // standalone prints fine in ~300ms. The old code read that empty stream as
  // "Not found" and red-flagged Node/Git/hooksPath. A version/config probe is
  // idempotent, so quiet retries distinguish the lost stream from a tool that
  // genuinely fails. Contract: every caller here runs an IDEMPOTENT probe
  // (`--version`, `config --get`, `rev-parse`) — a future side-effecting call
  // site must pass { attempts: 1 } to opt out of the retry below. The option
  // is consumed here and never forwarded to exec.
  // Scope note: only the exit-0-with-empty-stream shape is retried. A probe
  // that exits non-zero is a REAL failure verdict (cmd.exe reports a missing
  // tool as exit 1 + "'x' is not recognized"), and re-running it would only
  // burn time, so that path still returns null immediately.
  const { attempts, ...execOpts } = opts;
  const maxAttempts = process.platform === 'win32' ? (attempts || 3) : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        ...execOpts,
        timeout: execOpts.timeout || EXEC_TIMEOUT_MS,
      });
      if (!stdout.trim() && !stderr.trim()) {
        // Exit-0-but-empty: nothing usable came back. Retry while attempts
        // remain; report null once they are exhausted, so every caller's
        // existing null check ("probe produced nothing") applies — an empty
        // non-null result would read as a present tool with no version.
        if (attempt + 1 < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }
        return null;
      }
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err) {
      // #525: a bare null here reads as "tool missing" and has already cost a
      // misdiagnosis round. Name the sandbox once when it is the sandbox.
      noteSandboxAttribution(err);
      return null;
    }
  }
  // Exhausted all attempts with exit-0-but-empty streams: report null so every
  // caller's existing null check ("probe produced nothing usable") applies —
  // an empty non-null result would read as a present tool with no version.
  return null;
}

/**
 * Probe whether synchronous child-process creation works in this process (#525).
 *
 * @param {Array<{name: string, status: string, detail: string}>} checks — mutated
 * @returns {number} always 0, for assertion convenience in tests only — callers
 *   MUST ignore it: a sandbox WARN is environmental, never an issue count.
 *   (`formatDoctorJson` likewise excludes this check from missing_tools.)
 */
function checkSpawnCapability(checks) {
  let result;
  try {
    result = spawnSync(process.execPath, ['--version'], {
      encoding: 'utf8',
      timeout: EXEC_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    checks.push({ name: 'Spawn capability', status: 'SKIP', detail: `probe could not run: ${err.message}` });
    return 0;
  }
  if (!result.error) {
    checks.push({
      name: 'Spawn capability',
      status: 'PASS',
      detail: `sync spawn OK (node ${(result.stdout || '').trim() || 'unknown'})`,
    });
    return 0;
  }
  if (result.error.code === 'EBUSY') {
    checks.push({ name: 'Spawn capability', status: 'WARN', detail: EBUSY_ATTRIBUTION });
    // Context for the rest of the report (#525 R1): the sandbox hits every
    // sync spawn, so sibling FAIL entries ("Not found" et al) may share this
    // cause instead of being real machine problems.
    console.error('  ⚠ Other FAIL/WARN entries in this report may share this cause (they run sync spawns too).');
    return 0;
  }
  checks.push({ name: 'Spawn capability', status: 'SKIP', detail: `probe error: ${result.error.code || result.error.message}` });
  return 0;
}

function isXpGateFile(filePath, signature) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes(signature);
  } catch {
    return false;
  }
}

function getConfig() {
  if (!fs.existsSync(CONFIG_FILE())) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
  } catch {
    return 'corrupt';
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(config, null, 2));
}

async function getGitDir() {
  try {
    const result = await execWithTimeout('git rev-parse --git-dir');
    return result ? result.stdout : null;
  } catch {
    return null;
  }
}

/**
 * Synchronous version for --fix code path (runs before async diagnosis).
 * Always includes a 3-second timeout.
 */
function getGitDirSync() {
  try {
    return execSync('git rev-parse --git-dir', {
      encoding: 'utf8',
      timeout: EXEC_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    noteSandboxAttribution(err); // a sync-spawn EBUSY here reads as "not a git repo" otherwise (#525)
    return null;
  }
}

async function getCurrentHooksPath() {
  const result = await execWithTimeout('git config --global core.hooksPath', {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return result ? result.stdout : null;
}

/**
 * Synchronous version for --fix code path (runs before async diagnosis).
 * Always includes a 3-second timeout.
 */
function getCurrentHooksPathSync() {
  try {
    return execSync('git config --global core.hooksPath', {
      encoding: 'utf8',
      timeout: EXEC_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    noteSandboxAttribution(err); // a sync-spawn EBUSY here reads as "hooksPath not set" otherwise (#525)
    return null;
  }
}

/**
 * Check environment dependencies — runs all checks IN PARALLEL.
 * @param {Array} checks — mutated with results
 * @returns {Promise<boolean>} all ok
 */
async function checkEnv(checks) {
  const envChecks = [
    { name: 'Node.js', cmd: 'node --version' },
    { name: 'Git', cmd: 'git --version' }
  ];

  const results = await Promise.allSettled(
    envChecks.map(async (env) => {
      const result = await execWithTimeout(env.cmd, { stdio: ['ignore', 'pipe', 'pipe'] });
      return { name: env.name, result };
    })
  );

  let allOk = true;
  for (const entry of envChecks) {
    const settled = results.find(r => r.value && r.value.name === entry.name);
    const version = settled && settled.value && settled.value.result
      ? settled.value.result.stdout.split('\n')[0]
      : null;
    if (version) {
      checks.push({ name: `Environment: ${entry.name}`, status: 'PASS', detail: version });
    } else {
      checks.push({ name: `Environment: ${entry.name}`, status: 'FAIL', detail: 'Not found' });
      allOk = false;
    }
  }

  // Bash check uses checkBash() for robust cross-platform detection
  // (handles Windows Git Bash at common install paths)
  const bashResult = checkBash();
  if (bashResult.ok) {
    const versionStr = bashResult.version
      ? `GNU bash, version ${bashResult.version} (${bashResult.path})`
      : `bash found at ${bashResult.path}`;
    checks.push({ name: 'Environment: Bash', status: 'PASS', detail: versionStr });
  } else {
    checks.push({ name: 'Environment: Bash', status: 'FAIL', detail: 'Not found' });
    allOk = false;
  }

  return allOk;
}

/**
 * Validate config file exists, is parseable, and has a known mode.
 * Returns { config: object|null, checks: Array, issues: number }
 * When config is unrecoverable, returns null to stop further checks.
 */
function checkConfig() {
  const config = getConfig();
  if (config === null) {
    return { config: null, checks: [{ name: 'Config file', status: 'FAIL', detail: 'Not found' }], issues: 1 };
  }
  if (config === 'corrupt') {
    return { config: null, checks: [{ name: 'Config file', status: 'FAIL', detail: 'Corrupt JSON' }], issues: 1 };
  }
  if (config.mode !== 'local' && config.mode !== 'global') {
    return { config: null, checks: [
      { name: 'Config file', status: 'PASS', detail: CONFIG_FILE() },
      { name: 'Install mode', status: 'FAIL', detail: `Unknown: ${config.mode}` }
    ], issues: 1 };
  }
  return { config, checks: [
    { name: 'Config file', status: 'PASS', detail: CONFIG_FILE() },
    { name: 'Install mode', status: 'PASS', detail: config.mode }
  ], issues: 0 };
}

async function checkLocalHooks(checks) {
  let issues = 0;
  const gitDir = await getGitDir();
  if (!gitDir) {
    checks.push({ name: 'Git repository', status: 'FAIL', detail: 'Not in a git repo' });
    return 1;
  }
  const hooksDir = path.join(gitDir, 'hooks');
  issues += checkSingleHook(hooksDir, 'pre-commit', SIGNATURES['pre-commit'], 'Hooks', checks);
  issues += checkSingleHook(hooksDir, 'pre-push', SIGNATURES['pre-push'], 'Hooks', checks);
  issues += checkSingleHook(hooksDir, 'post-merge', SIGNATURES['post-merge'], 'Hooks', checks);
  return issues;
}

async function checkGlobalHooks(checks) {
  let issues = 0;
  issues += checkSingleHook(GLOBAL_HOOKS_DIR(), 'pre-commit', SIGNATURES['pre-commit'], 'Global hooks', checks);
  issues += checkSingleHook(GLOBAL_HOOKS_DIR(), 'pre-push', SIGNATURES['pre-push'], 'Global hooks', checks);
  issues += checkSingleHook(GLOBAL_HOOKS_DIR(), 'post-merge', SIGNATURES['post-merge'], 'Global hooks', checks);

  const hooksPath = await getCurrentHooksPath();
  if (hooksPath === null || hooksPath === '') {
    checks.push({ name: 'Git core.hooksPath', status: 'FAIL', detail: 'Not set' });
    issues++;
  } else if (!pathsEquivalent(hooksPath, GLOBAL_HOOKS_DIR())) {
    checks.push({ name: 'Git core.hooksPath', status: 'FAIL', detail: `Expected ${GLOBAL_HOOKS_DIR()}, got ${hooksPath}` });
    issues++;
  } else {
    checks.push({ name: 'Git core.hooksPath', status: 'PASS', detail: GLOBAL_HOOKS_DIR() });
  }
  return issues;
}

/**
 * Compare two paths that must denote the same directory.
 *
 * `git config` echoes core.hooksPath with forward slashes on Windows while
 * path.join builds GLOBAL_HOOKS_DIR with backslashes, and drive letters come
 * back lower-cased depending on who wrote them. A byte comparison therefore
 * reported every correctly configured Windows machine as broken, and --fix
 * could never clear it because the value it wrote read back differently (#496).
 */
function pathsEquivalent(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const normalize = (p) => {
    let s = p.replace(/[\\/]+/g, '/');
    if (s.length > 1) s = s.replace(/\/+$/, '');
    return s.replace(/^([A-Za-z]):/, (m, drive) => `${drive.toUpperCase()}:`);
  };
  return normalize(a) === normalize(b);
}

/**
 * Hook files eligible for repo-vs-installed drift comparison. Only hooks that
 * exist on both sides are compared, so a repo without post-merge is not flagged.
 * The lib/ shared libraries (sourced by pre-commit at runtime) are covered
 * separately by diagnoseHookDrift/syncGlobalHooksFromRepo (#488).
 */
const DRIFT_COMPARED_HOOKS = ['pre-commit', 'pre-push', 'post-merge'];

/**
 * Non-hook files that must sit beside the installed hooks.
 *
 * These are not Git entry points, so they are not in DRIFT_COMPARED_HOOKS, but
 * the hooks source them and die without them:
 *   - hook-module-resolution.sh (#505): pre-commit aborts FATAL when the module
 *     resolution order is missing. It is generated from lib/hook-module-resolution.js.
 */
const HOOK_SUPPORT_FILES = ['hook-module-resolution.sh'];

/**
 * Compare the hooks that actually execute (the installed copy under
 * core.hooksPath) against the repository's source-of-truth `githooks/` (#451).
 *
 * Editing `githooks/pre-commit` in a repo has no local effect when
 * `core.hooksPath` points at an installed copy, and nothing used to report how
 * far the two had diverged or in which direction. A stale installed copy makes
 * the local gate *looser* than the repo (silent under-enforcement); a newer one
 * makes it *stricter* (spurious local failures). Both need to be visible.
 *
 * Direction uses mtime, which is the only ordering signal available without a
 * shared version marker. It is reported as a hint, not as proof of content order.
 *
 * @param {{repoRoot?: string, repoHooks?: string, installedHooks?: string}} [ctx]
 * @returns {{checks: Array<{name: string, status: string, detail: string}>, issues: number}}
 */
function diagnoseHookDrift(ctx = {}) {
  const checks = [];
  let issues = 0;

  // XP_GATE_REPO_ROOT lets a caller (or a test) name the canonical repo
  // explicitly instead of inferring it from the process cwd.
  const repoRoot = ctx.repoRoot || process.env.XP_GATE_REPO_ROOT || process.cwd();
  const repoHooks = ctx.repoHooks || path.join(repoRoot, 'githooks');
  const installedHooks = ctx.installedHooks || GLOBAL_HOOKS_DIR();

  // Nothing to compare when the project carries no canonical *hook* source, or
  // when no global copy exists at all. Both must stay completely silent.
  //
  // A `githooks/` directory holding only `adapters/` is NOT a hook source of
  // truth -- consumer projects get that layout from `xp-gate init`, and the
  // adapters there are unrelated to which hook file executes.
  if (!hasCanonicalHooks(repoHooks) || !fs.existsSync(installedHooks)) {
    return { checks, issues };
  }

  for (const name of DRIFT_COMPARED_HOOKS) {
    const repoFile = path.join(repoHooks, name);
    const installedFile = path.join(installedHooks, name);
    if (!fs.existsSync(repoFile) || !fs.existsSync(installedFile)) continue;

    const label = `Hook drift: ${name}`;
    let repoStat;
    let installedStat;
    try {
      repoStat = fs.statSync(repoFile);
      installedStat = fs.statSync(installedFile);
    } catch {
      continue;
    }

    if (filesAreIdentical(repoFile, installedFile)) {
      checks.push({ name: label, status: 'PASS', detail: 'Installed copy matches githooks/' });
      continue;
    }

    const direction = installedStat.mtimeMs > repoStat.mtimeMs
      ? 'installed copy is newer than githooks/'
      : 'githooks/ is newer than the installed copy (installed copy is older)';
    checks.push({
      name: label,
      status: 'FAIL',
      detail: `${direction} — local commits run githooks/${name} only after syncing`,
    });
    issues++;
  }

  // lib/ shared libraries: pre-commit sources lib/*.sh at runtime, so a missing
  // or stale installed lib/ copy breaks the hook entirely after a sync (#488).
  const repoLib = path.join(repoHooks, 'lib');
  const installedLib = path.join(installedHooks, 'lib');
  if (fs.existsSync(repoLib) && fs.statSync(repoLib).isDirectory()) {
    let libEntries = [];
    try {
      libEntries = fs.readdirSync(repoLib, { withFileTypes: true });
    } catch {
      libEntries = [];
    }
    for (const entry of libEntries) {
      if (!entry.isFile()) continue;
      const rel = `lib/${entry.name}`;
      const repoFile = path.join(repoLib, entry.name);
      const installedFile = path.join(installedLib, entry.name);
      const label = `Hook drift: ${rel}`;
      if (!fs.existsSync(installedFile)) {
        checks.push({
          name: label,
          status: 'FAIL',
          detail: 'installed lib/ copy is missing (hooks source lib/ at runtime)',
        });
        issues++;
      } else if (!filesAreIdentical(repoFile, installedFile)) {
        checks.push({
          name: label,
          status: 'FAIL',
          detail: 'installed lib/ copy differs from githooks/lib/',
        });
        issues++;
      } else {
        checks.push({ name: label, status: 'PASS', detail: 'Installed copy matches githooks/' });
      }
    }
  }

  return { checks, issues };
}

/** Compare two files by content length first, then by bytes. */
function filesAreIdentical(fileA, fileB) {
  try {
    const a = fs.readFileSync(fileA);
    const b = fs.readFileSync(fileB);
    return a.length === b.length && a.equals(b);
  } catch {
    return false;
  }
}

/**
 * Does this directory actually hold canonical hook source?
 *
 * Requires at least one of the compared hook files to exist. A directory with
 * only `adapters/` (what `xp-gate init` writes into consumer projects) does not
 * qualify: there is no hook there to be the source of truth.
 *
 * @param {string} repoHooks
 * @returns {boolean}
 */
function hasCanonicalHooks(repoHooks) {
  if (!fs.existsSync(repoHooks)) return false;
  return DRIFT_COMPARED_HOOKS.some((name) => fs.existsSync(path.join(repoHooks, name)));
}

/**
 * Module names installed where the hook will look for them.
 *
 * pre-commit resolves an adapter flat first (`adapters/typescript.sh`) and only
 * then nested (`adapters/adapters/typescript.sh`), so the file that executes is
 * whichever of those two exists -- and only that one. Comparing the other copy
 * would report drift in a file git never runs.
 *
 * @param {string} installedAdapterDir
 * @returns {Array<{name: string, file: string}>}
 */
function listExecutedModules(installedAdapterDir) {
  const found = [];
  const seen = new Set();

  // #505: the tier order is DATA, not a second implementation. The hook reads a
  // generated shell projection of the same module; both reference
  // RESOLUTION_ORDER, so "which copy executes" has one answer. Previously this
  // function re-derived the order by hand and a parity test was the only thing
  // keeping it honest.
  //
  // Tiers are walked in order; a name is reported once, from the first tier that
  // resolves it — matching the hook, which stops at the first existing file.
  for (const tier of RESOLUTION_ORDER) {
    // Only the two ADAPTER_DIR-rooted tiers describe the installed adapter dir.
    if (tier.base !== 'ADAPTER_DIR') continue;
    // `{name}.sh` (flat) -> the dir itself; `adapters/{name}.sh` -> <dir>/adapters.
    const dir = tier.template.includes('/')
      ? path.join(installedAdapterDir, tier.template.split('/{name}.sh')[0])
      : installedAdapterDir;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.sh')) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      found.push({ name: entry.name, file: path.join(dir, entry.name) });
    }
  }

  return found;
}

/**
 * Where the repository keeps the source of truth for one executed module.
 *
 * Mirrors the installer's own split: `adapter-common.sh` and `gate-*.sh` are
 * copied from the githooks root, language adapters from `githooks/adapters/`.
 *
 * @param {string} repoHooks
 * @param {string} name
 * @returns {string|null}
 */
function repoModuleSource(repoHooks, name) {
  const rootLevel = name === 'adapter-common.sh' || /^gate-.+\.sh$/.test(name);
  const candidates = rootLevel
    ? [path.join(repoHooks, name)]
    : [path.join(repoHooks, 'adapters', name), path.join(repoHooks, name)];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Which lines each side carries that the other does not.
 *
 * Content equality alone cannot tell a plain stale copy from a bidirectional
 * divergence, and the difference decides whether overwriting is safe: a stale
 * copy is a subset of the repo, while a machine-hardened copy holds lines the
 * repo has never had. Blank/indentation noise is folded away so a reformatted
 * file does not read as divergence.
 *
 * @param {string} repoText
 * @param {string} installedText
 * @returns {{repoOnly: number, installedOnly: number}}
 */
function contentDelta(repoText, installedText) {
  const lineSet = (text) => new Set(
    text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  );
  const repo = lineSet(repoText);
  const installed = lineSet(installedText);
  let repoOnly = 0;
  let installedOnly = 0;
  for (const line of repo) if (!installed.has(line)) repoOnly++;
  for (const line of installed) if (!repo.has(line)) installedOnly++;
  return { repoOnly, installedOnly };
}

/**
 * Read two files as text, returning null when either side is unreadable.
 */
function readPair(repoFile, installedFile) {
  try {
    return { repoText: fs.readFileSync(repoFile, 'utf8'), installedText: fs.readFileSync(installedFile, 'utf8') };
  } catch {
    return null;
  }
}

/**
 * Compare the gate modules that actually execute against the repository's
 * `githooks/` source (#495).
 *
 * `checkAdapters` only proves a gate script is *present*, and the hook drift
 * check stops at the hook files plus `lib/`. The modules pre-commit sources for
 * Gates 3/4/7/8/9/10 live in the global adapters directory, so a repo fix to
 * `githooks/gate-8.sh` was invisible here and inert locally at the same time --
 * which is why #493 stayed unfixed for so long.
 *
 * @param {{repoRoot?: string, repoHooks?: string, installedAdapters?: string}} [ctx]
 * @returns {{checks: Array<{name: string, status: string, detail: string}>, issues: number}}
 */
function diagnoseModuleDrift(ctx = {}) {
  const checks = [];
  let issues = 0;

  const repoRoot = ctx.repoRoot || process.env.XP_GATE_REPO_ROOT || process.cwd();
  const repoHooks = ctx.repoHooks || path.join(repoRoot, 'githooks');

  // Silent without a canonical repo source to compare against: consumer
  // projects have no `githooks/` root of truth, only what was installed.
  if (!hasCanonicalHooks(repoHooks)) {
    return { checks, issues };
  }

  const dirs = resolveExecutedModuleDirs({
    globalAdapterDir: ctx.globalAdapterDir || ctx.installedAdapters,
    projectGithooks: ctx.projectGithooks || repoHooks,
    scriptDir: ctx.scriptDir,
  });

  // Copies the hook never resolves to, occupying the lookup positions it does
  // resolve through. They are not drift -- nothing executes them -- but they are
  // how #500 reproduces: the next install order shift, or a move to project
  // mode, promotes one silently. Report with the absolute path so the developer
  // can judge; do not count, because no shipped command removes them (#495 R2).
  const executedFor = new Map();
  for (const name of repoModuleNames(repoHooks)) {
    const source = repoModuleSource(repoHooks, name);
    if (!source) continue;
    const executed = executedModulePath(name, dirs);
    executedFor.set(name, executed);

    if (!executed) continue; // not installed at all: nothing executes, nothing to judge
    if (pathsEquivalent(executed, source)) continue; // the repo's own copy runs

    const label = `${tierFor(executed, dirs).prefix}: ${name}`;
    if (filesAreIdentical(source, executed)) {
      checks.push({ name: label, status: 'PASS', detail: 'Executed copy matches githooks/' });
      continue;
    }

    const texts = readPair(source, executed);
    if (!texts) {
      checks.push({ name: label, status: 'FAIL', detail: 'executed copy could not be read for comparison' });
      issues++;
      continue;
    }
    const { repoOnly, installedOnly } = contentDelta(texts.repoText, texts.installedText);
    // contentDelta folds whitespace and line endings away, so an all-zero delta
    // means the two copies say the same thing differently. Calling that drift
    // would report FAIL while claiming zero unique lines (#495 Round 2).
    if (repoOnly === 0 && installedOnly === 0) {
      checks.push({ name: label, status: 'PASS', detail: 'Same content as githooks/, differing only in line endings or indentation' });
      continue;
    }
    const hint = TIER_HINTS[tierFor(executed, dirs).tier] || '';
    checks.push({ name: label, status: 'FAIL', detail: `${moduleDriftDetail(repoOnly, installedOnly)}${hint}` });
    issues++;
  }

  for (const [name, file] of nonExecutedCopies(dirs, executedFor)) {
    checks.push({
      name: `Non-executed copy: ${name}`,
      status: 'WARN',
      detail: `${file} is not executed (the hook resolves this module elsewhere), so it is installer residue and NOT counted as drift; `
        + 'it shadows the tracked file the moment ADAPTER_DIR resolves to its tier (#500). Remove it by hand -- no doctor command deletes installed copies.',
    });
  }

  return { checks, issues };
}

/**
 * Every `.sh` copy the repository knows about that the resolution did NOT pick.
 *
 * @param {ReturnType<typeof resolveExecutedModuleDirs>} dirs
 * @param {Map<string, string|null>} executedFor
 * @returns {Array<[string, string]>}
 */
function nonExecutedCopies(dirs, executedFor) {
  const found = [];
  const seenFiles = new Set();
  const tiers = [
    dirs.globalAdapterDir,
    path.join(dirs.globalAdapterDir, 'adapters'),
    dirs.adapterDir,
    path.join(dirs.adapterDir, 'adapters'),
    dirs.projectGithooks,
    path.join(dirs.projectGithooks, 'adapters'),
    dirs.scriptDir,
    path.join(dirs.scriptDir, 'adapters'),
  ];
  for (const dir of tiers) {
    for (const mod of listExecutedModules(dir)) {
      if (seenFiles.has(path.resolve(mod.file))) continue;
      if (!executedFor.has(mod.name)) continue; // not a module the repo ships
      const executed = executedFor.get(mod.name);
      if (executed && pathsEquivalent(executed, mod.file)) continue;
      if (pathsEquivalent(repoModuleSource(dirs.projectGithooks, mod.name) || '', mod.file)) continue;
      seenFiles.add(path.resolve(mod.file));
      found.push([mod.name, mod.file]);
    }
  }
  return found;
}

/**
 * Describe one drifted module by the direction of its drift.
 *
 * Only a module the *repo* is ahead of is safe to overwrite; anything where the
 * installed copy holds its own lines needs an explicit decision, because syncing
 * would delete work that exists nowhere else.
 */
function moduleDriftDetail(repoOnly, installedOnly) {
  if (repoOnly > 0 && installedOnly > 0) {
    return `diverged both ways — githooks/ has ${repoOnly} line(s) the install lacks, `
      + `the install has ${installedOnly} line(s) githooks/ lacks; sync refuses without an explicit decision`;
  }
  if (repoOnly > 0) {
    return `installed copy is stale (${repoOnly} line(s) in githooks/ absent from the install)`;
  }
  return `installed copy is newer than githooks/ (${installedOnly} line(s) absent from the repo)`;
}

/**
 * Copy the repository's executed gate modules over the installed ones (#495).
 *
 * Deliberately refuses to overwrite a module whose installed copy carries lines
 * the repo does not. That is the machine-only-hardening case (Gate 8's
 * detect-secrets fallback here), and a silent `--fix` destroying it would be
 * worse than the drift it repairs.
 *
 * @param {{repoRoot?: string, repoHooks?: string, installedAdapters?: string, force?: boolean}} [ctx]
 * @returns {{synced: string[], skipped: string[], refused: Array<{name: string, repoOnly: number, installedOnly: number}>, errors: string[], installedAdapters: string}}
 */
function syncModulesFromRepo(ctx = {}) {
  const synced = [];
  const skipped = [];
  const refused = [];
  const errors = [];

  // The diagnosis and the repair must agree on which repository they are talking
  // about, or `XP_GATE_REPO_ROOT doctor --sync-hooks` reports drift it never
  // clears (#495 Round 2; the same silent-no-op class #488/#416 outlawed).
  const repoRoot = ctx.repoRoot || process.env.XP_GATE_REPO_ROOT || process.cwd();
  const repoHooks = ctx.repoHooks || path.join(repoRoot, 'githooks');

  if (!hasCanonicalHooks(repoHooks)) {
    errors.push(`no canonical githooks/ source at ${repoHooks} -- nothing was synced`);
    return { synced, skipped, refused, errors, installedAdapters: ctx.installedAdapters || ctx.globalAdapterDir || GLOBAL_ADAPTERS_DIR(), sourceMissing: true };
  }

  // Same resolution the diagnosis used, so a FAIL the diagnosis can produce is a
  // FAIL this repair can clear -- in whichever tier it lives (#495 Round 3; the
  // Round-2 pair diagnosed two tiers and synced one, leaving a permanent exit 1).
  const dirs = resolveExecutedModuleDirs({
    globalAdapterDir: ctx.globalAdapterDir || ctx.installedAdapters,
    projectGithooks: ctx.projectGithooks || repoHooks,
    scriptDir: ctx.scriptDir,
  });
  const installedAdapters = dirs.globalAdapterDir;

  for (const name of repoModuleNames(repoHooks)) {
    const source = repoModuleSource(repoHooks, name);
    if (!source) continue;
    const target = executedModulePath(name, dirs);
    if (!target) continue; // nothing executes this module; residue is not this command's business
    if (pathsEquivalent(source, target)) {
      skipped.push(name);
      continue;
    }
    if (filesAreIdentical(source, target)) {
      skipped.push(name);
      continue;
    }

    const decision = copyGuardDecision(source, target, !!ctx.force);
    // Formatting-only: nothing to repair, and rewriting the file would churn it.
    if (!decision.refuse && !decision.forced && decision.repoOnly === 0 && decision.installedOnly === 0) {
      skipped.push(name);
      continue;
    }
    if (decision.refuse) {
      refused.push({ name, repoOnly: decision.repoOnly, installedOnly: decision.installedOnly, unknown: decision.unknown, target });
      continue;
    }

    try {
      fs.copyFileSync(source, target);
      fs.chmodSync(target, 0o755);
      synced.push(name);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }

  return { synced, skipped, refused, errors, installedAdapters, dirs, sourceMissing: false };
}

/**
 * Resolve the directories pre-commit will source its gate modules from, using
 * the same 3-tier order as the hook itself (#495). Without this, doctor's output
 * cannot answer "which copy is running".
 *
 * This is the single resolution model the printout, the drift diagnosis and the
 * repair all read from. Round 2 had a second tier list inside
 * `diagnoseModuleDrift()` that walked the project directory unconditionally and
 * labelled whatever it found "executed" -- but the hook only reaches
 * `$PROJECT_GITHOOKS/adapters/<lang>.sh` (githooks/pre-commit:67-69), never a
 * flat project copy, so that label asserted a direction that was false and
 * produced a FAIL no repair path could clear (#495 Round 3).
 *
 * @param {{globalAdapterDir?: string, installedAdapters?: string, projectGithooks?: string, scriptDir?: string}} [ctx]
 * @returns {{adapterDir: string, gateDir: string, globalAdapterDir: string, projectGithooks: string, scriptDir: string}}
 */
function resolveExecutedModuleDirs(ctx = {}) {
  const globalAdapterDir = ctx.globalAdapterDir || ctx.installedAdapters || GLOBAL_ADAPTERS_DIR();
  const projectGithooks = ctx.projectGithooks || defaultProjectGithooks();
  const scriptDir = ctx.scriptDir || GLOBAL_HOOKS_DIR();

  const has = (dir, file) => fs.existsSync(path.join(dir, file));

  let adapterDir = scriptDir;
  if (has(globalAdapterDir, 'adapter-common.sh')) {
    adapterDir = globalAdapterDir;
  } else if (has(projectGithooks, 'adapter-common.sh')) {
    adapterDir = projectGithooks;
  }

  let gateDir = adapterDir;
  if (!has(adapterDir, 'gate-3.sh')) {
    if (has(projectGithooks, 'gate-3.sh')) gateDir = projectGithooks;
    else if (has(scriptDir, 'gate-3.sh')) gateDir = scriptDir;
  }

  return { adapterDir, gateDir, globalAdapterDir, projectGithooks, scriptDir };
}

/**
 * The repository's `githooks/` as the hook itself derives it -- `git rev-parse
 * --show-toplevel` (githooks/pre-commit:31), not the current directory. Run
 * from a subdirectory, a cwd-based answer finds no `githooks/` and the whole
 * drift surface goes silent (#495 Round 3).
 */
function defaultProjectGithooks() {
  if (process.env.XP_GATE_REPO_ROOT) {
    return path.join(process.env.XP_GATE_REPO_ROOT, 'githooks');
  }
  try {
    const toplevel = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      timeout: EXEC_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (toplevel) return path.join(toplevel, 'githooks');
  } catch (err) {
    // Not a git repository -- fall back to the directory we were called in.
    // But an EBUSY is not "not a repository": name the sandbox instead (#525).
    noteSandboxAttribution(err);
  }
  return path.join(process.cwd(), 'githooks');
}

/**
 * Module names the repository carries as source of truth.
 *
 * Enumerated from the repo rather than from what happens to be installed: the
 * question the surface answers is "which copy of the file I changed is running",
 * and a name nobody installed has no executed copy to judge.
 *
 * @param {string} repoHooks
 * @returns {string[]}
 */
function repoModuleNames(repoHooks) {
  const names = new Set();
  const collect = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.sh')) names.add(entry.name);
    }
  };
  collect(repoHooks);
  collect(path.join(repoHooks, 'adapters'));
  return [...names].sort();
}

/**
 * Gate modules live flat next to `adapter-common.sh`; language adapters are
 * looked up flat first, then nested (githooks/pre-commit:54-77).
 */
function isGateModuleFile(name) {
  return name === 'adapter-common.sh'
    || name === 'sprint-gate.sh'
    || /^gate-.+\.sh$/.test(name);
}

/**
 * Which file pre-commit will actually read for one module name (#495 Round 3).
 *
 * @param {string} name
 * @param {ReturnType<typeof resolveExecutedModuleDirs>} dirs
 * @returns {string|null} null when nothing executes (the module is not installed)
 */
function executedModulePath(name, dirs) {
  // `adapter-common.sh` is sourced from ADAPTER_DIR (githooks/pre-commit:41)
  // before GATE_DIR is ever resolved, so it does not follow the gate-module chain.
  if (name === 'adapter-common.sh') {
    const sourced = path.join(dirs.adapterDir, name);
    return fs.existsSync(sourced) ? sourced : null;
  }
  const candidates = isGateModuleFile(name)
    ? [path.join(dirs.gateDir, name)]
    : [
      path.join(dirs.adapterDir, name),
      path.join(dirs.adapterDir, 'adapters', name),
      path.join(dirs.projectGithooks, 'adapters', name),
      path.join(dirs.scriptDir, 'adapters', name),
    ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Which tier an executed copy came from, so a FAIL says where it ran from.
 */
function tierFor(executedPath, dirs) {
  const under = (dir) => {
    const base = path.resolve(dir);
    const file = path.resolve(executedPath, '..');
    return pathsEquivalent(base, file) || file.startsWith(`${base}${path.sep}`) || file.startsWith(`${base}/`);
  };
  if (under(dirs.projectGithooks)) return { prefix: 'Module drift (project)', tier: 'project' };
  if (under(dirs.scriptDir)) return { prefix: 'Module drift (script dir)', tier: 'script dir' };
  return { prefix: 'Module drift', tier: 'global' };
}

const TIER_HINTS = {
  project: ' -- executed from the project tier: the hook resolves ADAPTER_DIR to <repo>/githooks and reads a flat copy before the nested source (#500)',
  'script dir': ' -- executed from the installed hooks dir: GATE_DIR fell through to $SCRIPT_DIR (githooks/pre-commit:84-85)',
};

/**
 * Decide whether one copy may be overwritten (#495 Round 2/3).
 *
 * Refuses when the destination holds lines the source lacks (machine-only
 * hardening) and ALSO when its content cannot be read: an unreadable
 * destination is unknown content, and unknown content is exactly what the
 * refusal exists to protect.
 *
 * @param {string} source
 * @param {string} target
 * @param {boolean} force
 * @returns {{refuse: boolean, forced: boolean, unknown: boolean, repoOnly: number, installedOnly: number}}
 */
function copyGuardDecision(source, target, force) {
  if (!fs.existsSync(target)) return { refuse: false, forced: false, unknown: false, repoOnly: 0, installedOnly: 0 };
  if (force) return { refuse: false, forced: true, unknown: false, repoOnly: 0, installedOnly: 0 };
  const texts = readPair(source, target);
  if (!texts) return { refuse: true, forced: false, unknown: true, repoOnly: 0, installedOnly: 0 };
  const { repoOnly, installedOnly } = contentDelta(texts.repoText, texts.installedText);
  return { refuse: installedOnly > 0, forced: false, unknown: false, repoOnly, installedOnly };
}

/**
 * Split a list of already-installed files into the ones a refresh may overwrite
 * and the ones a human must judge first (#495 Round 3).
 *
 * `fixStaleHooks()` used to hand the whole list to a forced, backup-less
 * `updateHooks()` call, which destroyed machine-only content inside the same
 * command whose module path refuses to do it.
 *
 * @param {Array<{name: string, source: string, target: string}>} entries
 * @returns {{safe: Array, diverged: Array, unknown: Array, hasBlocking: boolean}}
 */
function planStaleHookSync(entries) {
  const safe = [];
  const diverged = [];
  const unknown = [];
  for (const entry of entries) {
    if (!fs.existsSync(entry.target)) {
      safe.push(entry);
      continue;
    }
    const texts = readPair(entry.source, entry.target);
    if (!texts) {
      unknown.push(entry);
      continue;
    }
    const { repoOnly, installedOnly } = contentDelta(texts.repoText, texts.installedText);
    if (repoOnly === 0 && installedOnly === 0) continue; // same content, different line endings
    if (installedOnly > 0) diverged.push({ ...entry, repoOnly, installedOnly });
    else safe.push({ ...entry, repoOnly, installedOnly: 0 });
  }
  return { safe, diverged, unknown, hasBlocking: diverged.length > 0 || unknown.length > 0 };
}

/**
 * Print the resolved module directories so drift output is actionable (#495).
 */
function printEffectiveModules() {
  const { adapterDir, gateDir } = resolveExecutedModuleDirs();
  console.log('');
  console.log('Effective gate modules (sourced by pre-commit):');
  console.log('---------------------------------------------');
  console.log(`  ADAPTER_DIR: ${adapterDir}`);
  console.log(`  GATE_DIR:    ${gateDir}`);
}

/**
 * Print which hook files git will actually execute, and where they come from
 * (#451 REQ-3). A developer who edits `githooks/pre-commit` and sees no change
 * has no way to discover that a different copy is in charge; this makes the
 * effective path and its origin explicit.
 */
function printEffectiveHooks() {
  const projectHooksPath = path.join(process.cwd(), '.git', 'hooks');

  let configured = null;
  try {
    configured = execSync('git config --get core.hooksPath', {
      encoding: 'utf8',
      timeout: EXEC_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    // No explicit core.hooksPath -> git falls back to .git/hooks.
    // But an EBUSY is not "no hooksPath configured": attribute it (#525).
    noteSandboxAttribution(err);
    configured = '';
  }

  const effective = configured || projectHooksPath;
  const source = configured
    ? 'core.hooksPath (global install)'
    : '.git/hooks (project default)';

  console.log('');
  console.log('Effective hooks:');
  console.log('----------------');
  console.log(`  ${effective}`);
  console.log(`  source: ${source}`);
}

/**
 * Keep a copy of an installed file before `--sync-hooks` overwrites it (#566).
 *
 * #566 was a hook that existed on exactly one machine and in no commit: a local
 * edit to the installed `pre-push` that `--sync-hooks` replaced silently. The
 * repo side then looked correct and the work was gone -- unrecoverable, because
 * nothing had recorded that the installed copy held anything more.
 *
 * The refusal path already protects files whose content diverges. This covers the
 * remaining cases, where the overwrite is legitimate but still destroys the
 * previous version: `--force`, and files that differ only in whitespace.
 *
 * Copies land in a sibling `backups/` directory with a timestamp, so repeated
 * syncs never overwrite an older backup. The target's own directory is used
 * rather than the user's work tree, so this never litters a repository.
 *
 * @param {string} target existing file about to be overwritten
 * @param {string} backupsDir directory to place the copy in
 * @returns {string|null} path of the backup, or null when there was nothing to back up
 */
function backupBeforeOverwrite(target, backupsDir) {
  if (!fs.existsSync(target)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    fs.mkdirSync(backupsDir, { recursive: true });
    // The stamp has millisecond resolution, so two syncs inside the same
    // millisecond produce the same name and the second copy destroys the first —
    // the backup is worth nothing exactly when it is needed most (a rapid
    // "edit, sync, edit, sync" repair loop). Disambiguate instead of overwriting:
    // the first backup of a burst must survive the rest.
    let backup = path.join(backupsDir, `${path.basename(target)}.${stamp}.bak`);
    for (let n = 1; fs.existsSync(backup); n += 1) {
      backup = path.join(backupsDir, `${path.basename(target)}.${stamp}-${n}.bak`);
    }
    fs.copyFileSync(target, backup);
    return backup;
  } catch {
    // A backup that cannot be written must not abort the sync; the caller
    // reports the file it overwrote either way.
    return null;
  }
}

/**
 * Read a VERSION file, returning '' when it is missing or empty.
 *
 * Kept local and silent: the deploy log's version field must never be the reason
 * a sync fails, and "unknown" is a truthful value.
 *
 * @param {string} versionPath
 * @returns {string}
 */
function readVersionFile(versionPath) {
  try {
    return fs.readFileSync(versionPath, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Append one line to the deploy log beside the installed hooks (#583).
 *
 * The backup (#566) makes a damaged file recoverable; it does not answer the
 * question a downstream actually has — "was my patch eaten, and by which
 * version?". A directory of timestamped `.bak` files is readable only by someone
 * who already suspects an overwrite. #583 records three silent overwrites in one
 * day, one of which reverted a fail-open fix that had already been filed, fixed
 * and tested.
 *
 * One line per overwritten file, appended — never rewritten, because "three times
 * today" is exactly what the log exists to show.
 *
 * @param {string} logPath deploy log path
 * @param {{file: string, version: string, backup: string|null}} entry
 */
function appendDeployLogEntry(logPath, entry) {
  const stamp = new Date().toISOString();
  const backup = entry.backup ? path.basename(entry.backup) : '(no previous content)';
  const line = `${stamp} overwrote ${entry.file} from xp-gate ${entry.version} (previous saved as ${backup})\n`;
  try {
    fs.appendFileSync(logPath, line);
  } catch {
    // Same rule as the backup itself: a log that cannot be written must not
    // abort the sync. The overwrite still happens and still reports its name.
  }
}

/**
 * Copy the repository's `githooks/` over the installed global hooks (#451 REQ-2).
 *
 * This is the one-command escape from "I edited githooks/ and nothing changed".
 * Only hooks that exist in the repo are copied; unrelated files in the installed
 * directory are left alone.
 *
 * @param {{repoRoot?: string, repoHooks?: string, installedHooks?: string}} [ctx]
 * Every overwrite is preceded by a backup (#566): the previous version is copied
 * to `backups/` beside the installed hooks before it is replaced.
 *
 * @returns {{synced: string[], skipped: string[], refused: Array<{name: string, repoOnly: number, installedOnly: number}>, errors: string[], installedHooks: string, backups: string[]}}
 */
function syncGlobalHooksFromRepo(ctx = {}) {
  const repoRoot = ctx.repoRoot || process.env.XP_GATE_REPO_ROOT || process.cwd();
  const repoHooks = ctx.repoHooks || path.join(repoRoot, 'githooks');
  const installedHooks = ctx.installedHooks || GLOBAL_HOOKS_DIR();
  // #583: the version that performs the overwrite is part of the record. Read the
  // repo's VERSION beside the hooks, so the log answers "which release did this"
  // without the caller having to remember to pass it.
  const version = ctx.version
    || readVersionFile(path.join(repoRoot, 'VERSION'))
    || 'unknown';

  const synced = [];
  const skipped = [];
  const refused = [];
  const errors = [];
  const backups = [];
  const backupsDir = path.join(installedHooks, 'backups');
  const deployLog = path.join(installedHooks, 'deploy.log');

  if (!fs.existsSync(repoHooks)) {
    errors.push(`no githooks/ directory at ${repoHooks}`);
    return { synced, skipped, refused, errors, installedHooks, backups };
  }

  if (!hasCanonicalHooks(repoHooks)) {
    errors.push(`no hook files in ${repoHooks} (only adapters?) -- nothing to sync from`);
    return { synced, skipped, refused, errors, installedHooks, backups };
  }

  try {
    fs.mkdirSync(installedHooks, { recursive: true });
  } catch (err) {
    errors.push(`cannot create ${installedHooks}: ${err.message}`);
    return { synced, skipped, refused, errors, installedHooks, backups };
  }

  for (const name of DRIFT_COMPARED_HOOKS) {
    const source = path.join(repoHooks, name);
    if (!fs.existsSync(source)) {
      skipped.push(name);
      continue;
    }
    const target = path.join(installedHooks, name);
    try {
      if (fs.existsSync(target) && filesAreIdentical(source, target)) {
        skipped.push(name);
        continue;
      }
      // #566: the previous version is kept, because this overwrite is the moment
      // machine-only work is lost.
      const backup = backupBeforeOverwrite(target, backupsDir);
      if (backup) backups.push(backup);
      // copyFileSync preserves content; the exec bit is re-applied explicitly
      // because a copied hook that is not executable silently never runs.
      fs.copyFileSync(source, target);
      fs.chmodSync(target, 0o755);
      // #583: record it, so a downstream can tell an overwrite from a fresh
      // install without having to diff checksums first.
      appendDeployLogEntry(deployLog, { file: name, version, backup });
      synced.push(name);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }

  // Hook support files (#505): sourced by the hooks but not Git entry points, so
  // they need the same copy treatment or an upgraded install dies at the source
  // line. Treated like the hooks themselves (always refreshed, no refusal) —
  // they hold no machine-local content.
  for (const name of HOOK_SUPPORT_FILES) {
    const source = path.join(repoHooks, name);
    if (!fs.existsSync(source)) continue;
    const target = path.join(installedHooks, name);
    try {
      if (fs.existsSync(target) && filesAreIdentical(source, target)) {
        skipped.push(name);
        continue;
      }
      const backup = backupBeforeOverwrite(target, backupsDir);
      if (backup) backups.push(backup);
      fs.copyFileSync(source, target);
      appendDeployLogEntry(deployLog, { file: name, version, backup });
      synced.push(name);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }

  // lib/ shared libraries: pre-commit sources lib/*.sh, so a synced hook file
  // without its libraries dies at the source line on the machine (#488).
  const repoLib = path.join(repoHooks, 'lib');
  const installedLib = path.join(installedHooks, 'lib');
  if (fs.existsSync(repoLib) && fs.statSync(repoLib).isDirectory()) {
    try {
      fs.mkdirSync(installedLib, { recursive: true });
    } catch (err) {
      errors.push(`cannot create ${installedLib}: ${err.message}`);
      return { synced, skipped, refused, errors, installedHooks, backups };
    }
    let libEntries = [];
    try {
      libEntries = fs.readdirSync(repoLib, { withFileTypes: true });
    } catch (err) {
      errors.push(`cannot read ${repoLib}: ${err.message}`);
      return { synced, skipped, refused, errors, installedHooks, backups };
    }
    for (const entry of libEntries) {
      if (!entry.isFile()) continue;
      const rel = `lib/${entry.name}`;
      const source = path.join(repoLib, entry.name);
      const target = path.join(installedLib, entry.name);
      try {
        if (fs.existsSync(target) && filesAreIdentical(source, target)) {
          skipped.push(rel);
          continue;
        }
        // A shared library can carry machine-only hardening just like a gate
        // module does, so it gets the same refusal instead of an unconditional
        // overwrite (#488 Round 2 -- the module guard and the lib guard must not
        // disagree about how destructive a sync is allowed to be). Unreadable
        // content refuses too: unknown is not the same as safe (#495 Round 3).
        if (fs.existsSync(target)) {
          const decision = copyGuardDecision(source, target, !!ctx.force);
          if (decision.refuse) {
            refused.push({
              name: rel,
              repoOnly: decision.repoOnly,
              installedOnly: decision.installedOnly,
              unknown: decision.unknown,
            });
            continue;
          }
          if (decision.forced === false && decision.repoOnly === 0 && decision.installedOnly === 0) {
            skipped.push(rel);
            continue;
          }
        }
        const backup = backupBeforeOverwrite(target, backupsDir);
        if (backup) backups.push(backup);
        fs.copyFileSync(source, target);
        fs.chmodSync(target, 0o755);
        appendDeployLogEntry(deployLog, { file: rel, version, backup });
        synced.push(rel);
      } catch (err) {
        errors.push(`${rel}: ${err.message}`);
      }
    }
  }

  return { synced, skipped, refused, errors, installedHooks, backups };
}

/**
 * Check a single hook file exists and is an xp-gate file.
 */
function checkSingleHook(hooksDir, name, signature, label, checks) {
  const hookPath = path.join(hooksDir, name);
  if (!fs.existsSync(hookPath) || !isXpGateFile(hookPath, signature)) {
    checks.push({ name: `${label}: ${name}`, status: 'FAIL', detail: 'Missing or not xp-gate' });
    return 1;
  }
  // Existence and signature are not enough (#546): a hook rewritten with CRLF
  // line endings, or truncated mid-write, satisfies both and still cannot run.
  // Reporting it as healthy is worse than reporting nothing, because the
  // operator stops looking.
  //
  // The CRLF scan is pure and cheap; the `bash -n` probe spawns a process, so it
  // is skipped for files under the size floor below — test fixtures and stub
  // hooks are not the things that break here, and spawning bash per stub made
  // doctor slower than its own test timeout.
  const health = inspectHookFile(hookPath, { parseCheck: shouldParseCheck(hookPath) });
  if (!health.ok) {
    checks.push({
      name: `${label}: ${name}`,
      status: 'FAIL',
      detail: health.problems.join('; '),
    });
    return 1;
  }
  checks.push({ name: `${label}: ${name}`, status: 'PASS', detail: hookPath });
  return 0;
}

/**
 * Should the `bash -n` probe run for this hook?
 *
 * Measured on a real install: a 190 KB pre-commit takes ~90 ms to parse, but a
 * dozen stubs in a test fixture still add up to seconds of process spawns. The
 * CRLF scan catches the #546 failure without spawning anything, so the probe is
 * reserved for files large enough to be a real hook.
 * @param {string} hookPath - Hook path
 * @returns {boolean} Whether to run the parse check
 */
function shouldParseCheck(hookPath) {
  try {
    return fs.statSync(hookPath).size > PARSE_CHECK_MIN_BYTES;
  } catch {
    return false;
  }
}

/**
 * Expected gate scripts that should be present in the adapters directory.
 * gate-5.sh and gate-6.sh are inline in pre-commit, so they are NOT expected here.
 */
const EXPECTED_GATE_SCRIPTS = [
  'gate-3.sh',
  'gate-4.sh',
  'gate-7.sh',
  'gate-8.sh',
  'gate-9.sh',
  'gate-10.sh',
];

async function checkAdapters(checks, mode, gitDirPromise) {
  const gitDir = typeof gitDirPromise === 'string' ? gitDirPromise : await gitDirPromise;
  let issues = 0;
  const adaptersDir = mode === 'local'
    ? path.join(path.dirname(gitDir || ''), 'githooks', 'adapters')
    : GLOBAL_ADAPTERS_DIR();

  if (!adaptersDir || !fs.existsSync(adaptersDir)) {
    checks.push({ name: 'Adapters directory', status: 'FAIL', detail: 'Missing' });
    return 1;
  }
  const adapterFiles = fs.readdirSync(adaptersDir).filter(f => f.endsWith('.sh'));
  if (adapterFiles.length === 0) {
    checks.push({ name: 'Adapters directory', status: 'FAIL', detail: 'Empty directory' });
    return 1;
  }
  checks.push({ name: 'Adapters directory', status: 'PASS', detail: `${adapterFiles.length} file(s)` });

  // Check for missing gate scripts (Issue #263 follow-up)
  const missingGates = EXPECTED_GATE_SCRIPTS.filter(g => !adapterFiles.includes(g));
  if (missingGates.length > 0) {
    checks.push({
      name: 'Gate scripts',
      status: 'FAIL',
      detail: `Missing: ${missingGates.join(', ')} — run 'xp-gate doctor --fix' to restore`
    });
    issues++;
  } else {
    checks.push({ name: 'Gate scripts', status: 'PASS', detail: `${EXPECTED_GATE_SCRIPTS.length} gate script(s) present (presence only; content is covered by the Module drift checks)` });
  }

  return issues;
}

/**
 * Build check report for the doctor.
 * Returns { checks: Array<{name, status, detail}>, issues: number }
 *
 * Uses Promise.allSettled to run independent checks in parallel.
 * Check groups:
 *   A) Config-dependent (config, version, templateDir) — sequential (data deps)
 *   B) Hooks — depends on config.mode + gitDir
 *   C) Adapters — depends on config.mode
 *   D) Env + CLI tools — fully independent, run IN PARALLEL
 *   E) TUI + Skills — independent, run IN PARALLEL
 */
async function diagnoseAsync(refreshEnv = false) {
  const checks = [];
  let issues = 0;

  // Spawn capability probe FIRST (sync, no config dependency) — #525: it must
  // report even when the config early-exits below, and its WARN (environmental,
  // never an issue count) primes the interpretation of every later FAIL. The
  // attribution dedup scope is one diagnosis, so reset it here.
  ebusyAttributionShown = false;
  checkSpawnCapability(checks);

  // --- Phase 1: Config-dependent checks (sequential, data dependencies) ---
  const configResult = checkConfig();
  if (configResult.config === null) {
    return { checks: configResult.checks, issues: configResult.issues };
  }
  const { config } = configResult;
  checks.push(...configResult.checks);
  issues += configResult.issues;

  // Version check (sync, no I/O)
  issues += diagnoseVersion(config, getPackageVersion(), checks);
  // TemplateDir check (sync, no I/O)
  issues += diagnoseTemplateDir(config, checks);
  // (Spawn capability probe already ran at the top of diagnoseAsync — #525.)

  // --- Phase 2: Fetch gitDir early (needed by hooks and adapters) ---
  const gitDirPromise = getGitDir();

  // --- Phase 3: Run independent groups in parallel ---
  // Group A: Hooks (needs config.mode + gitDir)
  const hooksPromise = (async () => {
    if (config.mode === 'local') {
      return checkLocalHooks(checks);
    }
    return checkGlobalHooks(checks);
  })();

  // Group B: Adapters (needs config.mode + gitDir)
  const adaptersPromise = checkAdapters(checks, config.mode, gitDirPromise);

  // Group C: Environment checks + CLI tools — fully parallel
  const envPromise = checkEnv(checks);
  // #469: the tool probes run in the hook environment; --refresh-env swaps in
  // the registry PATH so "installed but invisible" separates from "not
  // installed". The staleness check runs always: it is what makes a stale
  // terminal's green verdict honest.
  const cliToolsPromise = diagnoseCliToolsAsync(checks, { refreshEnv });
  const stalenessPromise = diagnosePathStaleness(checks);

  // Group D: TUI + Skills (independent)
  const tuiPromise = diagnoseTuiRegistration(checks);
  const skillsPromise = diagnoseInstalledSkills(config, checks);

  // Group E: repo-vs-installed hook drift (#451). Independent of config.mode:
  // the drift matters exactly because the installed copy, not githooks/, is
  // what executes. Detect if this is the xp-gate repo itself.
  const driftPromise = Promise.resolve().then(() => {
    const drift = diagnoseHookDrift();
    checks.push(...drift.checks);
    // The gate modules pre-commit sources at runtime drift independently of the
    // hook files and live in a different directory (#495).
    const moduleDrift = diagnoseModuleDrift();
    checks.push(...moduleDrift.checks);
    return drift.issues + moduleDrift.issues;
  });

  // Wait for ALL parallel groups
  const results = await Promise.allSettled([
    hooksPromise,
    adaptersPromise,
    envPromise,
    cliToolsPromise,
    stalenessPromise,
    tuiPromise,
    skillsPromise,
    driftPromise,
  ]);

  // Collect issue counts from settled promises
  for (const result of results) {
    if (result.status === 'fulfilled' && typeof result.value === 'number') {
      issues += result.value;
    }
  }

  return { checks, issues };
}

/**
 * #469 layer 1: the hook environment is the authoritative visibility test.
 *
 * git executes hooks through `bash -c` (Git Bash on Windows, /bin/sh on
 * POSIX), so whether a gate tool is callable is decided by `command -v`
 * inside THAT shell — not by `where` in the doctor's cmd.exe, and not by the
 * doctor's own inherited PATH. Probing any other environment answers a
 * different question than the one the hook asks, which is exactly how
 * doctor came to report "healthy" on machines where every hook failed with
 * "command not found" (#469).
 *
 * @param {string} toolName
 * @param {string|null} bashPath — resolved bash (checkBash), null when absent
 * @param {NodeJS.ProcessEnv} [env] — environment override (--refresh-env)
 * @returns {Promise<string|null>} resolved path (bash's POSIX form on Windows) or null
 */
async function probeToolInHookEnv(toolName, bashPath, env) {
  const isWindows = process.platform === 'win32';
  // Interpolation guard (walkthrough FC-04): toolName goes into a shell
  // command string verbatim. Callers pass internal constants today, but this
  // function is exported — anything outside the tool-name character set is
  // rejected fail-closed rather than executed.
  if (!/^[A-Za-z0-9._-]+$/.test(toolName)) return null;
  const shell = isWindows ? (bashPath || 'bash') : '/bin/sh';
  const inner = `command -v ${toolName}`;
  const cmd = isWindows ? `"${shell}" -c "${inner}"` : `${shell} -c '${inner}'`;
  const result = await execWithTimeout(cmd, { stdio: ['ignore', 'pipe', 'pipe'], env });
  if (!result || !result.stdout) return null;
  const first = result.stdout.split('\n')[0].trim();
  return first || null;
}

/**
 * Split a Windows PATH-style list into entries. Accepts the raw string the
 * registry stores (`;`-separated) or an already-split array.
 */
function splitPathEntries(rawPath) {
  if (Array.isArray(rawPath)) return rawPath.filter(Boolean);
  return String(rawPath || '').split(';').map((s) => s.trim()).filter(Boolean);
}

/** Normalize a directory for set comparison: trailing separators, slashes, case. */
function normalizeDirEntry(entry) {
  return String(entry || '')
    .replace(/[\\/]+$/, '')
    .replace(/\//g, '\\')
    .toLowerCase();
}

/**
 * Registry PATH entries the current process cannot see (#469 layer 2).
 *
 * On Windows the registry value and the process environment block are two
 * copies of PATH; anything written to the registry after this process
 * started is invisible to it (and to every hook it spawns). Such an entry
 * means "installed, but this terminal is too old to see it" — the false-green
 * class this issue exists to kill.
 */
function findStalePathEntries(processPath, registryEntries) {
  const visible = new Set(splitPathEntries(processPath).map(normalizeDirEntry));
  const stale = [];
  for (const entry of splitPathEntries(registryEntries)) {
    const norm = normalizeDirEntry(entry);
    if (!norm || visible.has(norm)) continue;
    if (stale.some((s) => normalizeDirEntry(s) === norm)) continue;
    stale.push(entry);
  }
  return stale;
}

/**
 * The process PATH extended with the registry entries it cannot see.
 *
 * Process PATH FIRST, registry-only entries appended: the purpose is not to
 * simulate a new terminal's resolution order but to make freshly-installed
 * tools VISIBLE to the probes without disturbing the resolution of the
 * environment this doctor run is diagnosing. Registry-first was tried and is
 * wrong: it re-resolves `bash` itself (System32's WSL stub can win), and the
 * probe layer dies with the shell it meant to use. Resolution-order fidelity
 * is irrelevant here — a stale entry is already reported by the PATH
 * freshness check, and `command -v` only needs the directory to be present.
 */
function buildRefreshedPath(processPath, registry) {
  const ordered = [
    ...splitPathEntries(processPath),
    ...findStalePathEntries(processPath, registry && registry.machine),
    ...findStalePathEntries(processPath, registry && registry.user),
  ];
  const out = [];
  const seen = new Set();
  for (const entry of ordered) {
    const norm = normalizeDirEntry(entry);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(entry);
  }
  return out.join(';');
}

/**
 * Extract the Path value from `reg query <key> /v Path` output:
 *   "    Path    REG_EXPAND_SZ    C:\a;C:\b"
 * Returns null when the value line is absent (bad key, wrong value name).
 */
function parseRegQueryPath(stdout) {
  const line = String(stdout || '')
    .split(/\r?\n/)
    .find((l) => /^\s+Path\s+REG_[A-Z_]+\s+\S/.test(l));
  if (!line) return null;
  return line.replace(/^\s+Path\s+REG_[A-Z_]+\s+/, '').trim();
}

async function queryRegistryPathValue(key) {
  const result = await execWithTimeout(`reg query "${key}" /v Path`, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!result) return { entries: [], error: `reg query failed for ${key}` };
  const raw = parseRegQueryPath(result.stdout);
  if (!raw) return { entries: [], error: `no Path value under ${key}` };
  return { entries: splitPathEntries(raw), error: null };
}

/**
 * The persistent PATH from the registry — what a NEW terminal would see.
 * Fail-closed: an unreadable hive returns `error`, and the caller WARNs
 * instead of claiming a freshness it cannot know.
 */
async function readRegistryPath() {
  if (process.platform !== 'win32') {
    return { supported: false, user: [], machine: [], userError: null, machineError: null, error: null };
  }
  const user = await queryRegistryPathValue('HKCU\\Environment');
  const machine = await queryRegistryPathValue(
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
  );
  // `error` is the combined view for callers that need a single boolean
  // ("could I read everything?"); userError/machineError carry the halves
  // separately so staleness can use partial evidence (walkthrough FC-07).
  return {
    supported: true,
    user: user.entries,
    machine: machine.entries,
    userError: user.error,
    machineError: machine.error,
    error: user.error || machine.error || null,
  };
}

/**
 * #469 layer 2: compare the process PATH against the registry.
 *
 * A registry entry the process cannot see means "installed, but this
 * terminal is too old to see it" — so a "Not found" verdict for a tool that
 * lives under such an entry is a false claim, and a "✓ All checks passed"
 * over a stale terminal is a false green. WARN, not FAIL: the machine may
 * be perfectly healthy; only this terminal is stale, and the remedy is a
 * new terminal (or `xp-gate doctor --refresh-env`).
 */
async function diagnosePathStaleness(checks, options = {}) {
  if (process.platform !== 'win32') return 0;
  const registry = options.registry || (await readRegistryPath());
  // Per-half fail-closed (walkthrough FC-07): a readable hive is still
  // evidence — discarding it because the OTHER half failed threw away partial
  // facts. Each half is compared independently; an unreadable half is
  // reported as an unknown, never as a PASS.
  const halves = [
    { label: 'User', entries: registry.user, error: registry.userError },
    { label: 'Machine', entries: registry.machine, error: registry.machineError },
  ];
  const usable = halves.filter((h) => !h.error);
  const unreadable = halves.filter((h) => h.error);

  let status = 'PASS';
  const parts = [];
  let stale;
  if (usable.length === 0) {
    // Fail closed: no readable hive is not evidence of freshness.
    checks.push({
      name: 'PATH freshness',
      status: 'WARN',
      detail: `Could not read the registry PATH (${halves.map((h) => `${h.label}: ${h.error}`).join('; ')}) — staleness unknown. After installing a tool, open a new terminal before trusting any "not found" verdict.`,
    });
    return 0;
  }
  stale = [
    ...usable.flatMap((h) => findStalePathEntries(process.env.PATH || '', h.entries)),
  ];
  if (unreadable.length > 0) {
    status = 'WARN';
    parts.push(`${unreadable.map((h) => `${h.label} hive unreadable (${h.error}), staleness unknown there`).join('; ')}`);
  }
  if (stale.length === 0) {
    parts.unshift(`process PATH matches the readable registry hive${usable.length === 2 ? 's' : ''} (${usable.map((h) => h.label).join(' + ')})`);
    checks.push({
      name: 'PATH freshness',
      status,
      detail: parts.join(' — '),
    });
    return 0;
  }
  status = 'WARN';
  // Which gate tools does THIS terminal lose to staleness? A tool visible in
  // the hook env only under the registry PATH is "installed but invisible" —
  // never "not installed".
  const bash = checkBash();
  const bashPath = bash.ok ? bash.path : null;
  const refreshedPath = buildRefreshedPath(process.env.PATH || '', registry);
  const invisible = [];
  if (bashPath) {
    await Promise.all(GATE_CLI_TOOLS.map(async (entry) => {
      const now = await probeToolInHookEnv(entry.tool, bashPath);
      if (now) return;
      const refreshed = await probeToolInHookEnv(entry.tool, bashPath, {
        ...process.env,
        PATH: refreshedPath,
      });
      if (refreshed) invisible.push(`${entry.tool} → ${refreshed}`);
    }));
  }
  const preview = stale.length <= 3
    ? stale.join(' ; ')
    : `${stale.slice(0, 3).join(' ; ')} ; …+${stale.length - 3} more`;
  parts.unshift(`PATH is stale — ${stale.length} registry entr${stale.length === 1 ? 'y' : 'ies'} invisible to this process (${preview})`);
  checks.push({
    name: 'PATH freshness',
    status: 'WARN',
    detail: parts.join(' — ')
      + '. A tool installed after this terminal opened needs a NEW terminal — or re-run: xp-gate doctor --refresh-env'
      + (invisible.length ? ` — installed-but-invisible gate tools: ${invisible.join(', ')}` : ''),
  });
  return 0;
}

/**
 * Async CLI tools check — runs each tool detection with a 3-second timeout
 * using async exec. Tools are checked IN PARALLEL via Promise.allSettled.
 * This mirrors checkCliTool logic but uses async exec for parallelization.
 *
 * #469: the probe environment is the HOOK environment (`bash -c`), and
 * `options.refreshEnv` re-probes against the registry PATH — what a freshly
 * opened terminal would see — so "installed but invisible" is distinguishable
 * from "not installed".
 *
 * @param {Array} checks
 * @param {{refreshEnv?: boolean}} [options]
 * @returns {Promise<number>} issue count
 */
async function diagnoseCliToolsAsync(checks, options = {}) {
  let issues = 0;
  const platform = process.platform;
  const isWindows = platform === 'win32';

  const bash = checkBash();
  const bashPath = bash.ok ? bash.path : null;

  let probeEnv;
  if (options.refreshEnv && isWindows) {
    const registry = await readRegistryPath();
    if (!registry.error) {
      probeEnv = { ...process.env, PATH: buildRefreshedPath(process.env.PATH || '', registry) };
    }
  }

  // Build parallel checks for each tool
  const toolChecks = GATE_CLI_TOOLS.map(async (entry) => {
    const toolName = entry.tool;
    const result = await detectCliToolAsync(toolName, isWindows, { bashPath, env: probeEnv });
    return { entry, toolName, result };
  });

  // Run ALL tool checks in parallel
  const results = await Promise.allSettled(toolChecks);

  // Collect results (maintain original order)
  for (const settled of results) {
    if (settled.status === 'rejected') continue;
    const { entry, result } = settled.value;
    const gateLabels = entry.gates.join(', ');

    if (result.available) {
      checks.push({
        name: `CLI tool: ${entry.tool} (${gateLabels})`,
        status: 'PASS',
        detail: result.version || 'available',
      });
    } else {
      const installCmd = getToolInstallCmd(entry, platform);
      checks.push({
        name: `CLI tool: ${entry.tool} (${gateLabels})`,
        status: 'WARN',
        detail: `Not found — install with: ${installCmd}`,
      });
      issues++;
    }
  }

  return issues;
}

/**
 * Async CLI tool detection — mirrors checkCliTool but uses async exec
 * with a hard 3-second timeout per subprocess call.
 *
 * #469: when bash is available the hook environment (`bash -c 'command -v'`)
 * is AUTHORITATIVE and there is no fall-through: a tool the hook cannot see
 * must not be reported available, however visible it is to `where` or to a
 * hardcoded local path. The where/which, direct-exec and local-path tiers
 * remain only for the no-bash case, where hooks cannot run at all
 * (checkEnv already FAILs Environment: Bash there).
 *
 * @param {string} toolName
 * @param {boolean} isWindows
 * @param {{bashPath?: string|null, env?: NodeJS.ProcessEnv}} [options]
 * @returns {Promise<{available: boolean, version?: string, path?: string}>}
 */
async function detectCliToolAsync(toolName, isWindows, options = {}) {
  const bashPath = options.bashPath || null;
  const env = options.env || undefined;

  if (bashPath) {
    const hookEnvPath = await probeToolInHookEnv(toolName, bashPath, env);
    if (hookEnvPath) {
      const version = await getVersionAsync(hookEnvPath, isWindows, { bashPath, env });
      return { available: true, path: hookEnvPath, version };
    }
    return { available: false };
  }

  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const execOpts = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell, timeout: EXEC_TIMEOUT_MS, env };

  // Step 1: Locate tool via which/where (async, 3s timeout)
  const locator = isWindows ? 'where' : 'which';
  const locatorResult = await execWithTimeout(`${locator} ${toolName}`, execOpts);
  if (locatorResult && locatorResult.stdout) {
    const resolvedPath = locatorResult.stdout.split('\n')[0].trim();
    if (resolvedPath) {
      const version = await getVersionAsync(resolvedPath, isWindows);
      return { available: true, path: resolvedPath, version };
    }
  }

  // Step 2: Direct exec fallback (async, 3s timeout)
  const fallbackCmd = isWindows
    ? `${toolName} --version`
    : `${toolName} --version 2>/dev/null || ${toolName} -v 2>/dev/null`;
  const fallbackResult = await execWithTimeout(fallbackCmd, execOpts);
  if (fallbackResult && fallbackResult.stdout) {
    return { available: true, path: toolName, version: fallbackResult.stdout.split('\n')[0] };
  }

  // Step 3: Check local fallback paths (sync fs, no exec)
  const localPaths = getLocalFallbackPathsSync(toolName, isWindows);
  for (const localPath of localPaths) {
    if (!fs.existsSync(localPath)) continue;
    const version = await getVersionAsync(localPath, isWindows);
    if (version) {
      return { available: true, path: localPath, version };
    }
  }

  return { available: false };
}

/**
 * Get version string from a tool path using async exec with 3s timeout.
 *
 * #469: a path resolved inside Git Bash is a POSIX path (`/c/...`), which
 * cmd.exe cannot execute — so the version probe stays in the shell that
 * resolved the path instead of failing with a misleading ENOENT.
 */
async function getVersionAsync(execPath, isWindows, options = {}) {
  const bashPath = options.bashPath || null;
  const env = options.env || undefined;
  // POSIX path test: a Git Bash-resolved path starts with '/', a Windows path
  // never does (drive letter or UNC). Enumerating prefixes (usr/, opt/, /c/)
  // was tried and leaks: /bin, /sbin, and every mount point outside the list
  // fall through to cmd.exe, which cannot run them (walkthrough FC-05).
  if (isWindows && bashPath && execPath.startsWith('/')) {
    const result = await execWithTimeout(
      `"${bashPath}" -c "${execPath} --version 2>/dev/null || ${execPath} -v 2>/dev/null"`,
      { stdio: ['ignore', 'pipe', 'pipe'], env }
    );
    return result && result.stdout ? result.stdout.split('\n')[0] : undefined;
  }
  const fallbackCmd = isWindows
    ? `"${execPath}" --version`
    : `"${execPath}" --version 2>/dev/null || "${execPath}" -v 2>/dev/null`;
  const result = await execWithTimeout(fallbackCmd, { env });
  return result && result.stdout ? result.stdout.split('\n')[0] : undefined;
}

/**
 * Get local fallback paths for CLI tool (sync, no exec).
 * Mirrors getLocalFallbackPaths from detect-deps.js.
 */
function getLocalFallbackPathsSync(toolName, isWindows) {
  const os = require('os');
  const home = os.homedir();
  const paths = [path.join(home, '.local', 'bin', toolName)];

  if (isWindows) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    paths.push(
      path.join(appData, 'npm', `${toolName}.cmd`),
      path.join(home, '.local', 'bin', `${toolName}.exe`),
    );
    const pythonBase = path.join(localAppData, 'Programs', 'Python');
    if (fs.existsSync(pythonBase)) {
      try {
        for (const entry of fs.readdirSync(pythonBase)) {
          if (entry.startsWith('Python')) {
            paths.push(path.join(pythonBase, entry, 'Scripts', `${toolName}.exe`));
          }
        }
      } catch { /* skip */ }
    }
  }

  return paths;
}

/**
 * Check 2: Version mismatch between config and package.
 * @returns {number} issue count (0 or 1)
 */
function diagnoseVersion(config, pkgVersion, checks) {
  const configVersion = config.version;
  if (configVersion && pkgVersion && configVersion !== pkgVersion) {
    checks.push({
      name: 'Version mismatch',
      status: 'FAIL',
      detail: `config: ${configVersion}, package: ${pkgVersion} — run 'xp-gate doctor --fix' to sync`
    });
    return 1;
  }
  return 0;
}

/**
 * Check 3: templateDir validation against platform expectation.
 * @returns {number} issue count (0 or 1)
 */
function diagnoseTemplateDir(config, checks) {
  const configTemplateDir = config.templateDir;
  if (configTemplateDir) {
    const expectedTemplateDir = getTemplateDir();
    if (configTemplateDir !== expectedTemplateDir) {
      checks.push({
        name: 'templateDir',
        status: 'FAIL',
        detail: `points to ${configTemplateDir}, expected ${expectedTemplateDir} for current platform`
      });
      return 1;
    }
  }
  return 0;
}

/**
 * Check CLI tools required by the quality gates.
 * Each gate has a set of CLI tools; if any are missing, that gate will SKIP
 * silently at commit time. This check makes the skip visible.
 *
 * @param {Array} checks
 * @returns {number} issue count
 */
function diagnoseCliTools(checks) {
  let issues = 0;
  const platform = process.platform;

  for (const entry of GATE_CLI_TOOLS) {
    const { available, version } = checkCliTool(entry.tool);
    const gateLabels = entry.gates.join(', ');

    if (available) {
      checks.push({
        name: `CLI tool: ${entry.tool} (${gateLabels})`,
        status: 'PASS',
        detail: version || 'available',
      });
    } else {
      const installCmd = getToolInstallCmd(entry, platform);
      checks.push({
        name: `CLI tool: ${entry.tool} (${gateLabels})`,
        status: 'WARN',
        detail: `Not found — install with: ${installCmd}`,
      });
      issues++;
    }
  }

  return issues;
}

/**
 * Print the check results in a readable format.
 */
function printReport(checks) {
  console.log('');
  console.log('Diagnosis Report:');
  console.log('-----------------');

  for (const check of checks) {
    // SKIP is "checked, not applicable" — rendering it as the failure symbol
    // made a healthy machine look broken (#525 R1 touched this via the
    // Spawn capability probe's SKIP branch).
    const statusSymbol = check.status === 'PASS' ? ' ✓' : check.status === 'WARN' ? ' ⚠' : check.status === 'SKIP' ? ' –' : ' ✗';
    console.log(`  ${statusSymbol} ${check.name}: ${check.detail}`);
  }
}

/**
 * Copy a hook file from package source to target, creating parent dir if needed.
 */
function restoreHook(srcFile, destFile, label) {
  if (!fs.existsSync(srcFile)) return false;
  const destDir = path.dirname(destFile);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcFile, destFile);
  fs.chmodSync(destFile, 0o755);
  console.log(`  ✓ Restored ${label}`);
  return true;
}

/**
 * Fix version mismatch — update config.version to match package version.
 * @param {object} config
 * @param {string|null} pkgVersion
 * @returns {boolean} Whether a fix was applied
 */
function fixVersionMismatch(config, pkgVersion) {
  if (pkgVersion && config.version !== pkgVersion) {
    config.version = pkgVersion;
    saveConfig(config);
    console.log(`  ✓ Updated config version to ${pkgVersion}`);
    return true;
  }
  return false;
}

/**
 * Fix templateDir mismatch — update config.templateDir to match expected.
 * @param {object} config
 * @param {string} expectedTemplateDir
 * @returns {boolean} Whether a fix was applied
 */
function fixTemplateDirMismatch(config, expectedTemplateDir) {
  if (config.templateDir && config.templateDir !== expectedTemplateDir) {
    config.templateDir = expectedTemplateDir;
    saveConfig(config);
    console.log(`  ✓ Updated templateDir to ${expectedTemplateDir}`);
    return true;
  }
  return false;
}

/**
 * Restore missing hooks from package source.
 * @param {'local'|'global'} mode
 * @param {string} srcDir - Package source directory
 * @param {string} hooksDir - Target hooks directory
 * @returns {boolean} Whether any hooks were restored
 */
function fixMissingHooks(mode, srcDir, hooksDir) {
  let fixed = false;
  const label = mode === 'local' ? '' : 'global ';
  const preCommitLabel = `${label}pre-commit hook`;
  const prePushLabel = `${label}pre-push hook`;
  const postMergeLabel = `${label}post-merge hook`;
  fixed = restoreHook(path.join(srcDir, 'hooks', 'pre-commit'), path.join(hooksDir, 'pre-commit'), preCommitLabel) || fixed;
  fixed = restoreHook(path.join(srcDir, 'hooks', 'pre-push'), path.join(hooksDir, 'pre-push'), prePushLabel) || fixed;
  fixed = restoreHook(path.join(srcDir, 'hooks', 'post-merge'), path.join(hooksDir, 'post-merge'), postMergeLabel) || fixed;
  return fixed;
}

/**
 * Fix core.hooksPath for global mode.
 * @param {string} globalHooksDir
 * @returns {boolean} Whether the fix was applied
 */
function fixCoreHooksPath(globalHooksDir) {
  try {
    // Args array instead of shell string interpolation: the value is a path
    // that must never be re-parsed by a shell. Also keeps semgrep's
    // detect-child-process rule from flagging this audited-safe call
    // (same baseline as .semgrepignore).
    execFileSync('git', ['config', '--global', 'core.hooksPath', globalHooksDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: EXEC_TIMEOUT_MS,
    });
    console.log(`  ✓ Set core.hooksPath to ${globalHooksDir}`);
    return true;
  } catch (e) {
    console.log(`  ✗ Could not set core.hooksPath: ${e.message}`);
    return false;
  }
}

/**
 * Restore missing adapters from package source.
 * @param {'local'|'global'} mode
 * @param {string} srcDir - Package source directory
 * @param {string} adaptersDir - Target adapters directory
 * @returns {boolean} Whether adapters were restored
 */
function fixMissingAdapters(mode, srcDir, adaptersDir) {
  if (adaptersDir && (!fs.existsSync(adaptersDir) || fs.readdirSync(adaptersDir).filter(f => f.endsWith('.sh')).length === 0)) {
    const pkgAdaptersDir = path.join(srcDir, 'adapters');
    if (fs.existsSync(pkgAdaptersDir)) {
      fs.mkdirSync(adaptersDir, { recursive: true });
      const adapterFiles = fs.readdirSync(pkgAdaptersDir).filter(f => f.endsWith('.sh'));
      for (const f of adapterFiles) {
        fs.copyFileSync(path.join(pkgAdaptersDir, f), path.join(adaptersDir, f));
      }
      console.log(`  ✓ Restored ${adapterFiles.length} adapter(s)`);
      return true;
    }
  }
  return false;
}

/**
 * Restore missing gate scripts from package root to adapters directory.
 * Gate scripts (gate-3.sh through gate-10.sh) are stored in the package root,
 * not in the adapters subdirectory.
 */
function fixMissingGateScripts(srcDir, adaptersDir) {
  if (!adaptersDir || !fs.existsSync(adaptersDir)) return false;

  const existingFiles = fs.readdirSync(adaptersDir);
  const missingGates = EXPECTED_GATE_SCRIPTS.filter(g => !existingFiles.includes(g));

  if (missingGates.length === 0) return false;

  let restored = 0;
  for (const gateScript of missingGates) {
    const srcFile = path.join(srcDir, gateScript);
    const destFile = path.join(adaptersDir, gateScript);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      fs.chmodSync(destFile, 0o755);
      restored++;
    }
  }

  if (restored > 0) {
    console.log(`  ✓ Restored ${restored} gate script(s)`);
    return true;
  }
  return false;
}

function fixConfigMismatches(config) {
  let fixed = false;
  fixed = fixVersionMismatch(config, getPackageVersion()) || fixed;
  fixed = fixTemplateDirMismatch(config, getTemplateDir()) || fixed;
  return fixed;
}

function fixHooksByMode(config, srcDir) {
  let fixed = false;
  if (config.mode === 'local') {
    const gitDir = getGitDirSync();
    if (gitDir) {
      const hooksDir = path.join(gitDir, 'hooks');
      fixed = fixMissingHooks('local', srcDir, hooksDir) || fixed;
    }
  } else {
    fixed = fixMissingHooks('global', srcDir, GLOBAL_HOOKS_DIR()) || fixed;
  }
  return fixed;
}

function fixGlobalHooksPath(config) {
  if (config.mode !== 'global') return false;
  const hooksPath = getCurrentHooksPathSync();
  if (!pathsEquivalent(hooksPath, GLOBAL_HOOKS_DIR())) {
    return fixCoreHooksPath(GLOBAL_HOOKS_DIR());
  }
  return false;
}

function getAdaptersDirByMode(config) {
  return config.mode === 'local'
    ? path.join(path.dirname(getGitDirSync() || ''), 'githooks', 'adapters')
    : GLOBAL_ADAPTERS_DIR();
}

/**
 * Attempt to fix known issues.
 * Only operates when mode === 'active' (local or global).
 */
function fixIssues(checks, config, installToolsFlag = false) {
  console.log('');
  console.log('Attempting fixes...');
  console.log('-------------------');

  const srcDir = PKG_DIR;
  let fixed = false;

  fixed = fixConfigMismatches(config) || fixed;
  fixed = fixHooksByMode(config, srcDir) || fixed;
  fixed = fixGlobalHooksPath(config) || fixed;
  fixed = fixMissingAdapters(config.mode, srcDir, getAdaptersDirByMode(config)) || fixed;
  fixed = fixMissingGateScripts(srcDir, getAdaptersDirByMode(config)) || fixed;
  fixed = fixStaleHooks(config) || fixed;
  fixed = fixHookDriftFromRepo() || fixed;
  // Installing a gate CLI (gitleaks/semgrep/lizard) changes the machine the same
  // way a language toolchain does, so it goes behind the same opt-in: `xp-gate
  // install` ends by running `doctor --fix`, which made an unguarded call here a
  // post-install network write nobody asked for (#502 Round 2). Guidance below
  // stays ungated, because reporting is not a mutation.
  if (installToolsFlag) {
    fixed = fixMissingCliTools() || fixed;
  }
  fixed = fixTuiRegistration() || fixed;
  fixed = printCliToolGuidance() || fixed;

  if (!fixed) {
    console.log('  No fixable issues found.');
  }
}

/**
 * Repair repo-vs-installed hook drift (#451).
 *
 * Only acts when the current project carries its own `githooks/` -- i.e. the
 * xp-gate repo (or a fork) rather than a consumer project, where githooks/ is
 * absent and the installed copy is the only source of truth.
 *
 * @returns {boolean} whether anything was synced
 */
function fixHookDriftFromRepo() {
  const repoHooks = path.join(process.env.XP_GATE_REPO_ROOT || process.cwd(), 'githooks');
  if (!fs.existsSync(repoHooks)) return false;

  const { synced, refused, errors } = syncGlobalHooksFromRepo();
  if (errors.length > 0) {
    for (const err of errors) console.log(`  ✗ ${err}`);
    return false;
  }
  for (const r of refused) {
    console.log(`  ⚠️  ${r.name} NOT synced — install has ${r.installedOnly} unique line(s); judge it, then use --sync-hooks --force, which overwrites with no backup, so keep a copy of the installed file first`);
  }
  if (synced.length === 0) return false;

  console.log(`  ✓ Synced ${synced.join(', ')} from githooks/ to ${GLOBAL_HOOKS_DIR()}`);
  return true;
}

/**
 * Sync hooks/adapters from the installed package to the project/global dir.
 * Catches cases where xp-gate was upgraded (npm update) but hooks are stale.
 * Refreshes only the files a content judgement has called safe to overwrite.
 *
 * @returns {boolean} Whether any hooks were updated
 */
function fixStaleHooks(config) {
  try {
    const { detectLocalModifications, getPackageRoot } = require('./update-hooks.js');
    const isGlobal = config.mode === 'global';
    const srcDir = getPackageRoot();

    let hooksDestDir, adaptersDestDir;
    if (isGlobal) {
      hooksDestDir = GLOBAL_HOOKS_DIR();
      adaptersDestDir = GLOBAL_ADAPTERS_DIR();
    } else {
      const gitDir = getGitDirSync();
      if (!gitDir) return false;
      const projectRoot = path.dirname(gitDir);
      hooksDestDir = path.join(gitDir, 'hooks');
      adaptersDestDir = path.join(projectRoot, 'githooks');
    }

    // Check if any hook files are stale (differ from package version)
    const modified = detectLocalModifications(srcDir, hooksDestDir, adaptersDestDir);
    if (modified.length === 0) return false;

    // Round 2 (architecture) caught the second overwrite standard inside this one
    // command: it handed every stale label to a forced updateHooks(), destroying
    // machine-only content the module path of the same release refuses to clobber.
    // `copyAdapters` writes flat AND nested, so both destinations are judged before
    // anything is written, and the refresh then copies file by file instead of
    // running a blanket force -- a backup-less blanket force deletes work, while the
    // backed-up alternative litters the user's work tree with .bak (#495 Round 3).
    const plan = planStaleHookSync(
      modified.flatMap((label) => staleSyncEntries(label, srcDir, hooksDestDir, adaptersDestDir)),
    );

    if (plan.hasBlocking) {
      console.log(`  ⚠️  ${plan.diverged.length + plan.unknown.length} hook/adapter file(s) NOT refreshed —`);
      console.log('     the installed copy carries content the package does not, and overwriting');
      console.log('     it would delete work that exists nowhere else:');
      for (const d of plan.diverged) {
        console.log(`     - ${d.name}: install has ${d.installedOnly} unique line(s), package has ${d.repoOnly}`);
      }
      for (const u of plan.unknown) {
        console.log(`     - ${u.name}: installed copy could not be read`);
      }
      console.log('     Judge them (fold the hardening into the package, or move the file aside),');
      console.log('     then re-run --fix.');
      console.log('     There is no automatic backup of an overwritten hook/adapter file and nothing');
      console.log('     in this tool can undo one — judge against a copy you kept, not against a rollback.');
    }

    if (plan.safe.length === 0) return plan.hasBlocking;

    console.log(`  Refreshing ${plan.safe.length} outdated hook/adapter file(s)...`);
    let refreshed = 0;
    for (const entry of plan.safe) {
      if (!fs.existsSync(entry.source)) continue;
      try {
        fs.mkdirSync(path.dirname(entry.target), { recursive: true });
        fs.copyFileSync(entry.source, entry.target);
        fs.chmodSync(entry.target, 0o755);
        refreshed++;
      } catch (err) {
        console.log(`  ✗ Could not refresh ${entry.name}: ${err.message}`);
      }
    }
    return refreshed > 0;
  } catch {
    return false;
  }
}

/**
 * Where one `detectLocalModifications()` label lives on both sides.
 *
 * `adapters/<f>.sh` is listed once but written twice by `copyAdapters` (flat and
 * nested), so a machine edit to either copy has to block the refresh. The flat
 * copy is only judged where it already exists -- creating one here would plant
 * the very installer residue #500 is about (#495 Round 3).
 */
function staleSyncEntries(label, srcDir, hooksDestDir, adaptersDestDir) {
  if (['pre-commit', 'pre-push', 'post-merge', 'sprint-gate.sh'].includes(label)) {
    const hooksSource = label === 'sprint-gate.sh'
      ? path.join(srcDir, label)
      : path.join(srcDir, 'hooks', label);
    return [{ name: label, source: hooksSource, target: path.join(hooksDestDir, label) }];
  }
  if (label.startsWith('adapters/')) {
    const file = label.slice('adapters/'.length);
    const source = path.join(srcDir, 'adapters', file);
    const entries = [{ name: label, source, target: path.join(adaptersDestDir, 'adapters', file) }];
    const flat = path.join(adaptersDestDir, file);
    if (fs.existsSync(flat)) entries.push({ name: `${label} (flat)`, source, target: flat });
    return entries;
  }
  return [{ name: label, source: path.join(srcDir, label), target: path.join(adaptersDestDir, label) }];
}

/**
 * Auto-install missing CLI tools via bootstrap.
 * @returns {boolean} Whether any tools were installed
 */
function fixMissingCliTools() {
  try {
    const { bootstrap } = require('./bootstrap.js');
    const missing = [];
    for (const entry of GATE_CLI_TOOLS) {
      const { available } = checkCliTool(entry.tool);
      if (!available) missing.push(entry.tool);
    }
    if (missing.length === 0) return false;

    console.log(`  Auto-installing ${missing.length} missing CLI tool(s)...`);
    const code = bootstrap([]);
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Print install guidance for missing CLI tools.
 * Does NOT auto-install — just shows commands.
 *
 * @returns {boolean} Whether any guidance was printed
 */
function printCliToolGuidance() {
  let guidance = false;
  const platform = process.platform;
  const missingTools = [];

  for (const entry of GATE_CLI_TOOLS) {
    const { available } = checkCliTool(entry.tool);
    if (!available) {
      const installCmd = getToolInstallCmd(entry, platform);
      missingTools.push({ tool: entry.tool, gates: entry.gates, installCmd, script: entry.optScript });
    }
  }

  if (missingTools.length > 0) {
    console.log('');
    console.log('  Missing CLI tools (affects quality gates):');
    for (const mt of missingTools) {
      const gateLabel = mt.gates[0];
      console.log(`    ${mt.tool}: needed by ${gateLabel}`);
      console.log(`      Install: ${mt.installCmd}`);
      if (mt.script) {
        console.log(`      Or run:  bash ${mt.script}`);
      }
    }
    console.log('');
    console.log(`  Or run 'xp-gate bootstrap' to install all at once.`);
    guidance = true;
  }

  return guidance;
}

/**
 * @param {string[]} args CLI arguments
 * @returns {number} exit code (0 = all clear, 1 = issues found)
 */
function isActiveMode(config) {
  return config && config !== 'corrupt' && (config.mode === 'local' || config.mode === 'global');
}

function isUninstalledMode(config) {
  return config && config !== 'corrupt' && config.mode === 'uninstalled';
}

/**
 * Check 7: Version upgrade check (non-blocking).
 */
async function diagnoseUpgrade() {
  try {
    const upgradeResult = await checkUpgrade();
    const msg = formatUpgradeMsg(upgradeResult, 'doctor');
    if (msg) {
      console.log(`\n  ℹ ${msg}`);
    }
  } catch { /* non-blocking — don't fail doctor on network issue */ }
}

/**
 * Check 8: OpenCode plugin version check.
 * @returns {number} issue count
 */
function diagnoseOpenCodePlugin(checks) {
  const pluginPath = path.join(HOME_DIR(), '.config', 'opencode', 'node_modules', '@boyingliu01', 'opencode-plugin', 'package.json');
  if (fs.existsSync(pluginPath)) {
    try {
      const pluginPkg = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
      const pluginVersion = pluginPkg.version;
      if (pluginVersion) {
        checks.push({ name: 'OpenCode plugin version', status: 'PASS', detail: pluginVersion });
        // Check if plugin is outdated vs xp-gate CLI (they should match)
        const pkgVersion = getPackageVersion();
        if (pkgVersion && pluginVersion !== pkgVersion) {
          checks.push({
            name: 'OpenCode plugin version mismatch',
            status: 'WARN',
            detail: `plugin: ${pluginVersion}, xp-gate CLI: ${pkgVersion} — run 'cd ~/.config/opencode && npm update @boyingliu01/opencode-plugin'`
          });
          return 1;
        }
      }
    } catch { /* skip */ }
  } else {
    checks.push({ name: 'OpenCode plugin', status: 'SKIP', detail: 'Not installed in OpenCode config' });
  }
  return 0;
}

/**
 * Diagnose language-specific tool availability.
 * @returns {number} Number of issues found (missing required tools)
 */
function diagnoseLanguageTools() {
  try {
    const { detectProjectLanguages, getToolsForLanguages, LANGUAGE_REGISTRY } = require('./language-tools.js');
    const projectRoot = process.cwd();
    const { detected } = detectProjectLanguages(projectRoot);

    if (detected.length === 0) return 0;

    console.log('');
    console.log('Language-Specific Tools:');
    console.log('------------------------');

    const toolStatus = getToolsForLanguages(detected);
    let issues = 0;

    for (const [lang, tools] of Object.entries(toolStatus)) {
      const langDef = LANGUAGE_REGISTRY[lang];
      console.log(`  ${langDef?.name || lang}:`);

      for (const t of tools) {
        const statusIcon = t.status === 'available' ? '✓' : '✗';
        const optMark = t.tool.optional ? ' (optional)' : '';
        const version = t.version || 'N/A';
        console.log(`    ${statusIcon} ${t.tool.name}${optMark} — ${version}`);

        if (t.status === 'missing' && !t.tool.optional) {
          issues++;
        }
      }
    }

    if (issues > 0) {
      console.log('');
      console.log(`  ${issues} required tool(s) missing — gates will SKIP.`);
      console.log('  Run "xp-gate install-tools --yes" to install.');
    }

    return issues;
  } catch {
    return 0;
  }
}

// #488: an unrecognised flag used to be silently ignored — the npm release
// that predates --sync-hooks made "doctor --sync-hooks" a silent no-op and the
// user believed a sync had happened. Fail loudly instead.
const KNOWN_FLAGS = ['--fix', '--sync-hooks', '--force', '--install-tools', '--json', '--format', '--refresh-env'];

/**
 * The accepted flag surface of `doctor`, as a pure function.
 *
 * The reason this is not inline in `doctor()`: this contract is about which
 * combinations are accepted, and answering that by running the real command
 * would exercise the repair surface (`--sync-hooks` copies repo files over the
 * installed ones). A contract that can only be tested by mutating the machine
 * is a contract nobody tests.
 *
 * @returns {{errors: string[], fixMode: boolean, syncHooks: boolean, force: boolean, installToolsFlag: boolean, jsonMode: boolean}}
 */
function doctorFlagContract(args) {
  const errors = [];
  // `--format json` carries a value; without this the value itself would be
  // reported as an unknown flag and the documented machine-readable mode could
  // never be reached (#304 promised it, nothing ever implemented it).
  const formatValue = args[args.indexOf('--format') + 1] || null;
  const flagTokens = args.filter((a, i) => !(i > 0 && args[i - 1] === '--format'));
  const unknownFlags = flagTokens.filter(a => !KNOWN_FLAGS.includes(a));
  if (unknownFlags.length > 0) {
    errors.push(`Unknown flag(s) for doctor: ${unknownFlags.join(', ')}`);
    errors.push(`Supported flags: ${KNOWN_FLAGS.join(', ')}`);
  }
  const fixMode = args.includes('--fix');
  const syncHooks = args.includes('--sync-hooks');
  // #495: overwriting a module whose installed copy holds lines the repo lacks
  // destroys machine-only hardening, so it needs this explicit opt-in.
  const force = args.includes('--force');
  // Installing a toolchain changes the machine, not the repository, so it is
  // never a side effect of --fix (#502). --fix reports the missing tools.
  const installToolsFlag = args.includes('--install-tools');
  // #469: re-probe CLI tools against the registry PATH (what a freshly opened
  // terminal would see) instead of this process's possibly-stale snapshot.
  // Read-only: it changes the probe environment, never the machine.
  const refreshEnv = args.includes('--refresh-env');
  const jsonMode = args.includes('--json') || (args.includes('--format') && formatValue === 'json');
  if (args.includes('--format') && !['json', 'text'].includes(formatValue)) {
    errors.push(`Unknown --format value: ${formatValue || '(none)'} — expected json or text`);
  }
  if (jsonMode && (fixMode || syncHooks)) {
    // A JSON report is a read; mixing it with the repair surface would put
    // progress prose into the stream a script is parsing.
    errors.push('--json/--format json cannot be combined with --fix or --sync-hooks');
  }
  // Round 4 (feasibility) caught the original #488 defect in a new place:
  // `--force` is read only by the sync path, so `doctor --force` and
  // `doctor --fix --force` were accepted, printed nothing and changed nothing.
  if (force && !syncHooks) {
    errors.push('--force is only read by --sync-hooks, where it overrides the divergence refusal and overwrites without a backup');
    errors.push('Pass --sync-hooks --force, or drop --force');
  }
  // Same class: --install-tools installs only inside the --fix repair surface.
  if (installToolsFlag && !fixMode) {
    errors.push('--install-tools is only read by --fix, and it is the only flag that installs toolchains onto this machine');
    errors.push('Pass --fix --install-tools, or drop --install-tools');
  }
  return { errors, fixMode, syncHooks, force, installToolsFlag, jsonMode, refreshEnv };
}

async function doctor(args) {
  const { errors, fixMode, syncHooks, force, installToolsFlag, jsonMode, refreshEnv } = doctorFlagContract(args);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    return 1;
  }

  if (!jsonMode) {
    console.log('XP-Gate Doctor');
    console.log('==============');
  }

  // §4.13 (#451 REQ-3): state which hook files actually execute, so "I edited
  // githooks/ but nothing changed" is answerable without reading git config.
  if (!jsonMode) printEffectiveHooks();
  // #495: the same for the gate modules the hook sources at runtime.
  if (!jsonMode) printEffectiveModules();

  const config = getConfig();

  // §4.8: mode === "uninstalled" → print "xp-gate is not installed"
  if (isUninstalledMode(config)) {
    if (jsonMode) {
      console.log(JSON.stringify(formatDoctorJson([{ name: 'Install', status: 'SKIP', detail: 'xp-gate is not installed' }], 0)));
      return 0;
    }
    console.log('xp-gate is not installed.');
    console.log('Run xp-gate init to install.');
    return 0;
  }

  // §4.13 (#451 REQ-2): explicit one-command sync from the repo's githooks/.
  if (syncHooks) {
    const { synced, skipped, refused, errors, installedHooks, backups } = syncGlobalHooksFromRepo({ force });
    if (errors.length > 0) {
      for (const err of errors) console.log(`  ✗ ${err}`);
      return 1;
    }
    if (synced.length > 0) {
      console.log(`  ✓ Synced ${synced.join(', ')} from githooks/ to ${installedHooks}`);
      console.log('    The updated hooks take effect on the next commit.');
    } else {
      console.log(`  ✓ Global hooks already match githooks/ (${skipped.join(', ') || 'nothing to sync'})`);
    }
    // #566: replacing an installed hook discards whatever was in it. Say where
    // the previous version went, so a machine-only fix stays recoverable.
    if (backups.length > 0) {
      console.log(`    Previous version(s) saved under ${path.join(installedHooks, 'backups')}/ (${backups.length} file(s)).`);
    }
    if (refused.length > 0) {
      console.log('');
      console.log(`  ⚠️  ${refused.length} shared library file(s) NOT synced — the installed copy`);
      console.log('     carries content githooks/ does not, so overwriting would delete work:');
      for (const r of refused) {
        console.log(`     - ${r.name}: install has ${r.installedOnly} unique line(s), githooks/ has ${r.repoOnly}`);
      }
      console.log('     Review them, then either fold the hardening into githooks/ or re-run --sync-hooks --force.');
      console.log('     Forcing overwrites the installed file, whose previous version is saved under backups/.');
    }

    // #495: the gate modules are what the hook sources for Gates 3/4/7/8/9/10,
    // so syncing only the hook files left the executed surface untouched.
    const moduleSync = syncModulesFromRepo({ force });
    if (moduleSync.errors.length > 0) {
      for (const err of moduleSync.errors) console.log(`  ✗ ${err}`);
      return 1;
    }
    if (moduleSync.synced.length > 0) {
      console.log(`  ✓ Synced ${moduleSync.synced.length} gate module(s) to ${moduleSync.installedAdapters}`);
      console.log(`    ${moduleSync.synced.join(', ')}`);
    }
    if (moduleSync.refused.length > 0) {
      console.log('');
      console.log(`  ⚠️  ${moduleSync.refused.length} module(s) NOT synced — the installed copy carries`);
      console.log('     content the repo does not, so overwriting would delete work (#495):');
      for (const r of moduleSync.refused) {
        console.log(`     - ${r.name}: install has ${r.installedOnly} unique line(s), githooks/ has ${r.repoOnly}`);
      }
      console.log('     Review them, then either fold the hardening into githooks/ or re-run --sync-hooks --force.');
      console.log('     Forcing overwrites the installed file, whose previous version is saved under backups/.');
    }
  }

  // §4.13: --fix only when mode === "active"
  if (fixMode && isActiveMode(config)) {
    fixIssues(null, config, installToolsFlag);
  }

  // Global timeout wrapper — ensures doctor completes within GLOBAL_DIAGNOSIS_TIMEOUT_MS
  // even if network/subprocess checks stack up (fix #348: 43s on Windows).
  const diagnosisPromise = diagnoseAsync(refreshEnv);
  let diagnosisTimer = null;
  const timeoutPromise = new Promise((resolve) => {
    diagnosisTimer = setTimeout(() => resolve({ checks: [{ name: 'Diagnosis', status: 'WARN', detail: `Timed out after ${GLOBAL_DIAGNOSIS_TIMEOUT_MS / 1000}s — some checks incomplete` }], issues: 0, timedOut: true }), GLOBAL_DIAGNOSIS_TIMEOUT_MS);
  });
  const { checks, issues: diagnosedIssues, timedOut } = await Promise.race([
    diagnosisPromise.then(r => ({ ...r, timedOut: false })),
    timeoutPromise,
  ]);
  clearTimeout(diagnosisTimer);
  let issues = diagnosedIssues;

  // A timeout discards every check that had not reported yet, including the
  // drift surface, so the raced result must never be allowed to read as clean
  // (#495 Round 2 -- this is the "stale modules, doctor green" outcome itself).
  if (timedOut) {
    issues = Math.max(issues, 1);
    const hookDrift = diagnoseHookDrift();
    const moduleDrift = diagnoseModuleDrift();
    checks.push(...hookDrift.checks, ...moduleDrift.checks);
    issues += hookDrift.issues + moduleDrift.issues;
  }

  let langIssues = 0;
  // Upgrade + plugin + language-tool status, kept as one callable because a
  // --format json run still has to execute all of it (#488).
  const collectTrailingChecks = async () => {
    try {
      const upgradePromise = diagnoseUpgrade();
      const upgradeTimeout = new Promise((resolve) => setTimeout(() => resolve(), 3000));
      await Promise.race([upgradePromise, upgradeTimeout]);
    } catch { /* non-blocking */ }
    const trailing = diagnoseOpenCodePlugin(checks);
    langIssues = diagnoseLanguageTools();
    return trailing + langIssues;
  };

  if (jsonMode) {
    // Machine-readable output means EXACTLY one JSON document on stdout, so the
    // human report and the trailing checks' chatter are silenced while their
    // results are still collected into `checks`.
    const say = console.log;
    console.log = () => {};
    try {
      issues += await collectTrailingChecks();
    } finally {
      console.log = say;
    }
    console.log(JSON.stringify(formatDoctorJson(checks, issues)));
    return issues > 0 ? 1 : 0;
  }

  printReport(checks);

  issues += await collectTrailingChecks();

  // In --fix mode, auto-install missing language tools — only on explicit
  // --install-tools (#502: a diagnosis command must not run package managers).
  if (fixMode && installToolsFlag && langIssues > 0) {
    try {
      const { detectProjectLanguages, getToolsForLanguages, installTool, generateProjectConfig, LANGUAGE_REGISTRY } = require('./language-tools.js');
      const projectRoot = process.cwd();
      const { detected } = detectProjectLanguages(projectRoot);
      if (detected.length > 0) {
        const toolStatus = getToolsForLanguages(detected);
        let installed = 0;
        for (const [lang, tools] of Object.entries(toolStatus)) {
          for (const t of tools) {
            if (t.status === 'missing') {
              const result = installTool(t.tool);
              if (result.success) {
                console.log(`  \u2713 ${t.tool.name} (${lang}) installed`);
                installed++;
              }
            }
          }
        }
        if (installed > 0) {
          console.log(`  ${installed} language tool(s) installed.`);
          generateProjectConfig(projectRoot, detected, toolStatus);
        }
      }
    } catch { /* non-blocking */ }
  }

  if (fixMode && !installToolsFlag && langIssues > 0) {
    console.log(`\n  ${langIssues} language tool(s) are missing. --fix did not install them —`);
    console.log('  installing a toolchain changes the machine, so opt in with --install-tools (#502).');
  }

  if (issues === 0) {
    console.log('\n✓ All checks passed');
    return 0;
  }

  console.log(`\n✗ ${issues} issue(s) found`);

  // Re-run diagnosis after fix to report updated status
  if (fixMode && isActiveMode(config)) {
    console.log('\nRe-running diagnosis after fix...');
    const postDiagPromise = diagnoseAsync();
    let postTimer = null;
    const postTimeout = new Promise((resolve) => {
      postTimer = setTimeout(() => resolve({
        checks: [{ name: 'Post-fix diagnosis', status: 'WARN', detail: `Timed out after ${GLOBAL_DIAGNOSIS_TIMEOUT_MS / 1000}s — the fix result is unconfirmed, not clean` }],
        issues: 1,
        timedOut: true,
      }), GLOBAL_DIAGNOSIS_TIMEOUT_MS);
    });
    const { checks: postChecks, timedOut: postTimedOut } = await Promise.race([
      postDiagPromise.then(r => ({ ...r, timedOut: false })),
      postTimeout,
    ]);
    clearTimeout(postTimer);
    // Symmetry with the pre-fix race above: a timeout here discards the drift
    // surface too, so the post-fix report must not read as "all clear".
    if (postTimedOut) {
      postChecks.push(...diagnoseHookDrift().checks, ...diagnoseModuleDrift().checks);
    }
    printReport(postChecks);
  }

  return issues > 0 ? 1 : 0;
}

function formatDoctorJson(checks, issues) {
  // missing_tools means "installable CLI tool absent" (#525 R1): the Spawn
  // capability WARN is environmental (host sandbox) and must not appear here,
  // or machine consumers would read a healthy machine as needing an install.
  const missing_tools = checks
    .filter(c => c.name !== 'Spawn capability' && (c.status === 'WARN' || c.status === 'FAIL'))
    .map(c => ({ name: c.name, detail: c.detail }));
  return {
    ok: issues === 0,
    issues,
    checks: checks.map(c => ({ name: c.name, status: c.status, detail: c.detail })),
    missing_tools,
  };
}

// ── doctor delphi (#414 REQ-3/REQ-6) ───────────────────────────────────
// Diagnoses the Delphi review chain end to end. Each check exists because a
// real failure was silent: drifted agent bindings looked like a working setup
// (B2), a stale skill copy made reinstall = downgrade (B4), and a missing
// runner script surfaced only as a failed review (B3).
async function doctorDelphi(options = {}) {
  const { configPath, npmLatest } = options;
  // #541: the shadow check needs the loader's global fallback path. It is
  // injectable for tests; the default mirrors delphi-config.ts /
  // delphi-external-review.cjs resolution (XDG_CONFIG_HOME honored).
  const globalConfigPath = options.globalConfigPath
    || path.join(process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config'), 'xp-gate', '.delphi-config.json');
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  // 1. Node >= 18: the runner gates on it and exits 1 mid-review otherwise.
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  add('Node.js >= 18', nodeMajor >= 18 ? 'PASS' : 'FAIL',
    `current: ${process.versions.node}`);

  // 2. Qoder agent bindings: present, parseable, three distinct ids, matching
  // what this version ships. A stale binding is a repair, not an error to
  // retype: the detail names delphi-setup. Project-level agents (from
  // `delphi-setup --local --project`) take precedence when a complete set
  // exists there, so the doctor agrees with the repair command (#414 R1 FC-09).
  const { readQoderModelId } = require('./init.js');
  const roles = ['architecture', 'technical', 'feasibility'];
  const homeAgentsDir = path.join(HOME_DIR(), '.qoder', 'agents');
  // Injectable for tests; defaults to the cwd the doctor runs from.
  const projectAgentsDir = path.join(options.projectDir || process.cwd(), '.qoder', 'agents');
  const homeComplete = roles.every((r) => fs.existsSync(path.join(homeAgentsDir, `delphi-${r}.md`)));
  const projectComplete = roles.every((r) => fs.existsSync(path.join(projectAgentsDir, `delphi-${r}.md`)));
  const agentsDir = projectComplete ? projectAgentsDir : homeAgentsDir;
  const agentsSource = projectComplete
    ? `project-level ${agentsDir}`
    : `user-level ${agentsDir}`;
  const agentIds = [];
  let agentsStatus = 'PASS';
  const agentDetails = [agentsSource];
  for (const role of roles) {
    const agentPath = path.join(agentsDir, `delphi-${role}.md`);
    if (!fs.existsSync(agentPath)) {
      agentsStatus = 'FAIL';
      agentDetails.push(`delphi-${role}.md missing (run: xp-gate init --global, or delphi-setup --local --project for project scope)`);
      continue;
    }
    const id = readQoderModelId(agentPath);
    if (id === null) {
      agentsStatus = 'FAIL';
      agentDetails.push(`delphi-${role}.md has no quoted model binding (repair: xp-gate delphi-setup)`);
      continue;
    }
    const bundledId = readQoderModelId(path.join(PKG_DIR, 'plugins', 'qoder', 'agents', `delphi-${role}.md`));
    if (bundledId === null) {
      // A bundle without a parseable template is install corruption: skipping
      // the comparison would hide it behind a healthy-looking id (#414 R1 FC-08).
      agentsStatus = 'FAIL';
      agentDetails.push(`delphi-${role}: bundled template missing/unreadable — reinstall xp-gate`);
      continue;
    }
    if (bundledId !== id) {
      agentDetails.push(`delphi-${role}: ${id} (this version ships ${bundledId} — repair: xp-gate delphi-setup)`);
    } else {
      agentDetails.push(`delphi-${role}: ${id}`);
    }
    agentIds.push(id);
  }
  // Report every problem class independently: missing files, unparseable
  // bindings and duplicates can coexist, and each has a different remedy
  // (#414 R1 MI-02).
  if (agentIds.length !== roles.length) agentsStatus = 'FAIL';
  if (new Set(agentIds).size !== agentIds.length) {
    agentsStatus = 'FAIL';
    agentDetails.push('duplicate model binding across experts — three DISTINCT ids are required');
  }
  add('Qoder Delphi agent bindings', agentsStatus, agentDetails.join('; ') || 'all three bound');

  // 3. Skill install parity: a drifted installed copy is how "reinstall from
  // an old local repo" became a downgrade (#414 B4). Every bundled file is
  // compared, not just SKILL.md — the install script copies *.json and
  // references/ too, and B4-style drift hits those equally (#414 R1 MI-03).
  const platform = detectPlatform();
  const installedSkillDir = platform === 'qoder'
    ? path.join(HOME_DIR(), '.qoder', 'skills', 'delphi-review')
    : platform === 'claude-code'
      ? path.join(HOME_DIR(), '.claude', 'skills', 'delphi-review')
      : path.join(HOME_DIR(), '.config', 'opencode', 'skills', 'delphi-review');
  // Injectable for tests (#414 R3 FC-01/FC-02): the empty-bundle branch is a
  // real failure mode and must be drivable without mutating the package.
  const bundledSkillDir = options.bundledSkillDir || path.join(PKG_DIR, 'skills', 'delphi-review');
  const sha256 = (p) => require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const listBundledSkillFiles = (dir, base = dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) listBundledSkillFiles(p, base, out);
      else out.push(path.relative(base, p));
    }
    return out;
  };
  if (!fs.existsSync(path.join(installedSkillDir, 'SKILL.md'))) {
    add('Delphi skill install parity', 'FAIL',
      `not installed at ${installedSkillDir} (install: xp-gate install-skill delphi-review)`);
  } else {
    const bundledFiles = listBundledSkillFiles(bundledSkillDir);
    if (bundledFiles.length === 0) {
      // An installed copy next to an empty bundle is install corruption —
      // "0 files match" must never read as healthy (#414 R2 MN-R2-01). The
      // bundled dir ships inside the installed package itself, so an
      // unreachable one is a broken install, not a transient condition
      // (#414 R3 FC-05): FAILing is the doctor's job here.
      add('Delphi skill install parity', 'FAIL',
        `bundled skill directory missing or empty: ${bundledSkillDir} — reinstall xp-gate`);
    } else {
      const drifted = [];
      for (const rel of bundledFiles) {
        const installedPath = path.join(installedSkillDir, rel);
        const bundledPath = path.join(bundledSkillDir, rel);
        if (!fs.existsSync(installedPath)) {
          drifted.push(`${rel}: missing`);
        } else if (sha256(installedPath) !== sha256(bundledPath)) {
          drifted.push(`${rel}: differs from bundle`);
        }
      }
      if (drifted.length > 0) {
        add('Delphi skill install parity', 'FAIL',
          `${drifted.length} file(s) differ from the ${getCliVersionSafe()} bundle: `
          + `${drifted.slice(0, 5).join('; ')}${drifted.length > 5 ? '; ...' : ''} `
          + '(reinstall: xp-gate install-skill delphi-review --force)');
      } else {
        add('Delphi skill install parity', 'PASS',
          `${bundledFiles.length} file(s) match the bundle`);
      }
    }
  }

  // 4. Runner script locate: the runner must be findable from the places a
  // review actually starts.
  const runnerCandidates = [
    ['package bundle', path.join(PKG_DIR, 'scripts', 'delphi-external-review.cjs')],
    ['project', path.join(process.cwd(), 'scripts', 'delphi-external-review.cjs')],
    ['installed skill', path.join(installedSkillDir, 'scripts', 'delphi-external-review.cjs')],
  ];
  const foundRunner = runnerCandidates.filter(([, p]) => fs.existsSync(p));
  add('delphi-external-review runner', foundRunner.length > 0 ? 'PASS' : 'FAIL',
    foundRunner.length > 0
      ? foundRunner.map(([label, p]) => `${label}: ${p}`).join('; ')
      : 'not found in package bundle, project, or installed skill');

  // 5. Config ping: parseable, three distinct callable models. A duplicate
  // model here is a review that will BLOCK later — say so now.
  const cfgPath = configPath || path.join(process.cwd(), '.delphi-config.json');
  if (!fs.existsSync(cfgPath)) {
    add('Delphi config (.delphi-config.json)', 'FAIL',
      `${cfgPath} not found (copy .delphi-config.json.example from the skill directory)`);
  } else {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const profileName = raw.active_profile || 'default';
      const profile = raw.profiles && raw.profiles[profileName];
      if (!profile) {
        add('Delphi config (.delphi-config.json)', 'FAIL', `profile "${profileName}" not found`);
      } else {
        const experts = profile.experts || {};
        const models = roles.map((r) => experts[r] && experts[r].model);
        const providers = profile.providers || {};
        const missingRoles = roles.filter((r, i) => !models[i]);
        const duplicates = models.filter((m, i) => m && models.indexOf(m) !== i);
        const badProviders = roles.filter((r) => {
          const e = experts[r];
          return !e || !providers[e.provider]
            || !providers[e.provider].base_url
            || String(providers[e.provider].base_url).indexOf('http') !== 0;
        });
        if (missingRoles.length > 0 || duplicates.length > 0 || badProviders.length > 0) {
          const problems = [];
          if (missingRoles.length > 0) problems.push(`missing experts: ${missingRoles.join(', ')}`);
          if (duplicates.length > 0) problems.push(`duplicate models: ${[...new Set(duplicates)].join(', ')}`);
          if (badProviders.length > 0) problems.push(`unusable provider binding: ${badProviders.join(', ')}`);
          add('Delphi config (.delphi-config.json)', 'FAIL', problems.join('; '));
        } else {
          add('Delphi config (.delphi-config.json)', 'PASS',
            `profile "${profileName}": ${models.join(' / ')}`);
          // #574: non-local seats are reported, not blocked. The local-only rule
          // is an operator preference (the 2026-10-03 quota burn), so doctor
          // surfaces the cost exposure without failing a deliberately hosted
          // seat. The HARD enforcement lives in Gate MW, which binds evidence to
          // whatever this file declares rather than to a local- prefix.
          // `scripts/check_delphi_local_models.py` holds the same rule with the
          // same allowlist and exit code; doctor reports it here so the guard
          // finally has a caller (`xp-gate doctor delphi`) instead of existing
          // only in its own docstring.
          const hostedSeats = roles.filter((r) => {
            const m = models[roles.indexOf(r)];
            return m && !String(m).toLowerCase().startsWith('local-');
          });
          if (hostedSeats.length > 0) {
            add('Delphi local-model guard (#574)', 'WARN',
              `hosted (non local-*) seats: ${hostedSeats.map((r) => `${r}=${models[roles.indexOf(r)]}`).join(', ')} — `
                + 'local-only review is the standing rule; run: python scripts/check_delphi_local_models.py --probe');
          } else {
            add('Delphi local-model guard (#574)', 'PASS', `all ${roles.length} seats are local-*`);
          }
        }
        // #541 follow-up: shadow detection. Loaders fall back to the global
        // config ONLY on ENOENT, so this project file always wins here. If the
        // machine-wide config exists AND seats differ, the effective model mix
        // depends on cwd — the cross-project drift class behind the 2026-10-03
        // quota burn. Warn (intentional overrides are legal), never fail.
        try {
          if (fs.existsSync(globalConfigPath) && path.resolve(globalConfigPath) !== path.resolve(cfgPath)) {
            const gRaw = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
            const gProfileName = gRaw.active_profile || 'default';
            const gProfile = gRaw.profiles && gRaw.profiles[gProfileName];
            const gExperts = (gProfile && gProfile.experts) || {};
            // Seat shape is object-keyed OR array in the wild (delphi-config.ts
            // accepts both); normalize to a role->model map before comparing.
            const pickExpert = (experts, role, idx) => {
              if (!experts) return null;
              if (Array.isArray(experts)) {
                const e = experts.find((x) => x && x.role === role) || experts[idx];
                return (e && e.model) || null;
              }
              return (experts[role] && experts[role].model) || null;
            };
            const gModels = roles.map((r, i) => pickExpert(gExperts, r, i));
            // Compare only roles BOTH sides define: a role missing on one side
            // is an incomplete config (check 5 already FAILs it), not drift.
            const differing = roles.filter((r, i) => gModels[i] && models[i] && gModels[i] !== models[i]);
            if (differing.length > 0) {
              add('Delphi config shadow (#541)', 'WARN',
                `project config shadows ${globalConfigPath}; seats differ (${differing.join(', ')}) — reviews run from other directories will use different models`);
            }
          }
        } catch {
          // A broken/unreadable global config is not this check's failure mode;
          // silence here must not mask it elsewhere, so nothing is claimed.
        }
      }
    } catch (err) {
      add('Delphi config (.delphi-config.json)', 'FAIL', `unparseable: ${err.message}`);
    }
  }

  // 6. Version consistency (#414 REQ-6): local files first. The npm-latest
  // probe is opt-in (options.probeNpmLatest) or pre-supplied
  // (options.npmLatest) — the doctor never blocks on the network, which is
  // what an offline CI or restricted shell would otherwise hit (#414 R1 FC-03).
  const localVersion = getCliVersionSafe();
  let versionStatus = 'PASS';
  let versionDetail = `xp-gate ${localVersion}`;
  if (npmLatest === undefined && options.probeNpmLatest === true) {
    try {
      versionDetail += `; npm latest probe: ${execWithTimeout('npm view @boyingliu01/xp-gate version', 8000).trim()}`;
    } catch {
      versionStatus = 'SKIP';
      versionDetail += '; npm latest probe unavailable (offline?) — skipped';
    }
  } else if (typeof npmLatest === 'string' && npmLatest !== localVersion) {
    versionStatus = 'FAIL';
    versionDetail += `; npm latest ${npmLatest} differs from local ${localVersion} — update (npm install -g @boyingliu01/xp-gate@latest) or verify which side is stale`;
  } else if (npmLatest === null || options.probeNpmLatest !== true) {
    versionDetail += '; npm latest probe skipped (pass --npm-check or options.probeNpmLatest to run it)';
  }
  add('Delphi version consistency', versionStatus, versionDetail);

  // 7. DSH native-channel readiness (#443 REQ-6): only meaningful when a DSH
  // home exists. The two-layer switch (preset capability + host setting)
  // defaults to disabled, and a review that assumes native will silently run
  // three same-model seats.
  const dshHome = path.join(HOME_DIR(), '.dsh');
  if (!fs.existsSync(dshHome)) {
    add('DSH subagent model selection', 'SKIP', `no ${dshHome} — not a DSH environment`);
  } else {
    const settingsCandidates = [
      path.join(dshHome, 'settings.json'),
      path.join(dshHome, 'settings', 'settings.json'),
      path.join(dshHome, 'config.json'),
    ];
    const settingsFile = settingsCandidates.find((p) => fs.existsSync(p));
    if (!settingsFile) {
      add('DSH subagent model selection', 'FAIL',
        `${dshHome} exists but no settings file found — subagent model selection defaults to disabled (#443)`);
    } else {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        const selection = settings.subagentModelSelection;
        const allowed = selection && Array.isArray(selection.allowedModels) ? selection.allowedModels : [];
        const ids = allowed.map((m) => (typeof m === 'string' ? m : m && m.id)).filter(Boolean);
        if (selection && selection.enabled === true && new Set(ids).size >= 3) {
          add('DSH subagent model selection', 'PASS', `${settingsFile}: enabled, ${new Set(ids).size} distinct allowed models`);
        } else if (selection && selection.enabled === true) {
          add('DSH subagent model selection', 'FAIL',
            `${settingsFile}: enabled but only ${new Set(ids).size} distinct allowedModels (need ≥3) — native channel unusable`);
        } else {
          // The switch shipping off is the platform default, not a defect:
          // only an operator who explicitly enables it and under-provisions
          // allowedModels has a real misconfiguration (#414 R1 FC-07).
          add('DSH subagent model selection', 'SKIP',
            `${settingsFile}: native model selection disabled (platform default) — the external channel is the contract path (#443)`);
        }
      } catch (err) {
        add('DSH subagent model selection', 'SKIP', `${settingsFile} unparseable: ${err.message}`);
      }
    }
  }

  for (const check of checks) {
    const mark = check.status === 'PASS' ? '✓' : check.status === 'SKIP' ? '○' : check.status === 'WARN' ? '⚠' : '✗';
    console.log(`  ${mark} ${check.name}: ${check.detail || check.status}`);
  }
  const failed = checks.filter((c) => c.status === 'FAIL').length;
  console.log('');
  console.log(failed === 0
    ? '  Delphi review chain: healthy.'
    : `  Delphi review chain: ${failed} check(s) FAILED.`);
  return failed === 0 ? 0 : 1;
}

function getCliVersionSafe() {
  try {
    return require('../package.json').version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

module.exports = {
  doctor, doctorDelphi, isXpGateFile, SIGNATURES,
  fixVersionMismatch,
  fixTemplateDirMismatch,
  fixMissingHooks,
  fixCoreHooksPath,
  fixMissingAdapters,
  diagnoseTuiRegistration,
  fixTuiRegistration,
  ensureTuiRegistration,
  readTuiJson,
  formatDoctorJson,
  diagnoseHookDrift,
  syncGlobalHooksFromRepo,
  diagnoseModuleDrift,
  syncModulesFromRepo,
  resolveExecutedModuleDirs,
  executedModulePath,
  repoModuleNames,
  copyGuardDecision,
  planStaleHookSync,
  doctorFlagContract,
  listExecutedModules,
  repoModuleSource,
  contentDelta,
  pathsEquivalent,
  checkSpawnCapability,
  execWithTimeout,
  EBUSY_ATTRIBUTION,
  probeToolInHookEnv,
  detectCliToolAsync,
  splitPathEntries,
  normalizeDirEntry,
  findStalePathEntries,
  buildRefreshedPath,
  parseRegQueryPath,
  readRegistryPath,
  diagnosePathStaleness,
};
