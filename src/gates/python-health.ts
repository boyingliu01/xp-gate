/**
 * Python Environment Health Check
 * Provides comprehensive Python environment diagnostics.
 * Layer 2 of #356: full diagnostics via CLI/doctor (not pre-commit hot path).
 *
 * Reuses common.ts infrastructure (isToolAvailable, runTool).
 */
import {
  isToolAvailable, runTool,
} from './common';
import fs from 'fs';
import path from 'path';

// ── Types ──

export interface PythonHealthResult {
  healthy: boolean;
  python: { available: boolean; version: string; exe: string };
  pip: { available: boolean; version: string };
  environment: { type: 'system' | 'venv' | 'conda' | 'pyenv' | 'uv'; path: string | null };
  tools: Array<{ name: string; available: boolean; version: string; required: boolean }>;
  issues: string[];
  /**
   * Whether the project showed any Python signal. When false, `tools` entries were
   * NOT probed and must not be read as "not installed" (#782 / REQ-GATE-PROBE-SHORTCUT).
   */
  toolProbesRan: boolean;
}

// ── Python Tool Registry (sync with language-tools.js LANGUAGE_REGISTRY.python) ──

const PYTHON_REQUIRED_TOOLS = ['mypy', 'pytest'];
const PYTHON_OPTIONAL_TOOLS = ['ruff', 'flake8', 'black'];

// ── Python Signal Detection ──

/**
 * Files whose presence declares "this is a Python project", independent of whether
 * any `.py` file currently exists. A freshly-scaffolded project, or one whose
 * Python sources are generated/ignored, still needs its tool diagnostics.
 */
const PYTHON_MARKER_FILES = [
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  'poetry.lock',
  'uv.lock',
  '.python-version',
];

/** Directories never worth walking when looking for a `.py` file. */
const SIGNAL_SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__',
  '.stryker-tmp', 'dist', 'build', '.tox', '.mypy_cache', '.pytest_cache',
]);

const SIGNAL_MAX_DEPTH = 4;
const SIGNAL_MAX_ENTRIES = 5000;

/**
 * Virtualenv directory names. Their presence alone is a Python signal even with
 * no marker file, common for `python -m venv .venv`-only setups.
 */
const VENV_DIR_NAMES = ['.venv', 'venv'];

/**
 * Does this project show any sign of being Python at all?
 *
 * This exists to answer the ONE question that must be asked BEFORE paying for
 * tool probes: "is there anything here for Python tooling to check?" On a
 * JavaScript/TypeScript project the answer is no, yet `checkPythonHealth` used to
 * probe mypy/pytest/ruff/flake8/black anyway — measured 3.2 s on this repo, where
 * those probes cannot possibly produce information about the code.
 *
 * The predicate is deliberately BROAD (marker file OR any `.py` file OR a Python
 * venv directory), because the failure mode of a too-narrow predicate is
 * "claimed to check Python, checked nothing" — the worst defect class in this
 * repo. A false positive only costs the old behaviour.
 *
 * Note on scope: this is a signal about the PROJECT, not about the change set —
 * the right question here, because python-health reports environment health rather
 * than scanning specific files. A project with ANY Python anywhere (this repo has
 * a real `tests/*.py` suite plus `githooks/lib/prepush-score.py`) correctly keeps
 * full diagnostics. The saving lands on genuinely single-language consumer
 * projects, which is the common case and the one the measurement fixture models.
 * Gitignored scratch trees cannot trigger it: any dot-directory is skipped.
 *
 * @param cwd project root to inspect; defaults to process.cwd()
 */
export function hasPythonSignal(cwd?: string): boolean {
  const root = cwd || process.cwd();
  return hasMarkerFile(root) || hasVenvDir(root) || containsPythonFile(root);
}

/** Is any marker file present? An unreadable root is not evidence either way. */
function hasMarkerFile(root: string): boolean {
  return PYTHON_MARKER_FILES.some((marker) => {
    try {
      return fs.existsSync(path.join(root, marker));
    } catch {
      return false;
    }
  });
}

/**
 * Is a virtualenv directory present? Only the signal matters here, so an
 * unreadable root still counts as a hit rather than being silently skipped.
 */
function hasVenvDir(root: string): boolean {
  return VENV_DIR_NAMES.some((venv) => {
    try {
      return fs.existsSync(path.join(root, venv));
    } catch {
      return true;
    }
  });
}

/** Should this directory be skipped during the .py walk? */
function shouldSkipDir(entry: import('fs').Dirent): boolean {
  return SIGNAL_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.');
}

/** A non-directory entry is a hit only if it is a .py file. */
function isPythonFileEntry(entry: import('fs').Dirent): boolean {
  return !entry.isDirectory() && entry.name.endsWith('.py');
}

/**
 * One directory level: does this directory or any descendant hold a .py file?
 * Split from containsPythonFile so the bounds and the traversal stay separately
 * readable, and bounded by depth and entry count so a pathological tree cannot
 * make a gate hang.
 */
/** The directory's entries, or null when it cannot be read. */
function readEntries(dir: string): import('fs').Dirent[] | null {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Unreadable is not "definitely not Python": the caller decides, and the caller
    // here treats it as "keep looking".
    return null;
  }
}

/** Whether the walk has spent its budget. */
function budgetExhausted(depth: number, counter: { seen: number }): boolean {
  return depth > SIGNAL_MAX_DEPTH || counter.seen > SIGNAL_MAX_ENTRIES;
}

/**
 * Whether this directory entry is, or contains, a Python file.
 *
 * The counter is incremented per ENTRY rather than per directory, so a tree with a
 * huge flat directory is bounded too -- the depth limit alone would not stop it.
 */
function entryLeadsToPython(dir: string, entry: import('fs').Dirent, depth: number, counter: { seen: number }): boolean {
  counter.seen += 1;
  if (counter.seen > SIGNAL_MAX_ENTRIES) return false;
  if (isPythonFileEntry(entry)) return true;
  if (!entry.isDirectory() || shouldSkipDir(entry)) return false;
  return walkForPythonFile(path.join(dir, entry.name), depth + 1, counter);
}

function walkForPythonFile(dir: string, depth: number, counter: { seen: number }): boolean {
  if (budgetExhausted(depth, counter)) return false;
  const entries = readEntries(dir);
  if (!entries) return false;
  return entries.some((entry) => entryLeadsToPython(dir, entry, depth, counter));
}

/**
 * Look for any .py file under root. Returns false on a read error: "could not
 * look" must never be reported as "definitely not Python".
 */
function containsPythonFile(root: string): boolean {
  return walkForPythonFile(root, 0, { seen: 0 });
}

// ── Python Detection ──

/**
 * Detect Python executable, filtering Windows Store stubs.
 * Order: python3 → python → py (Windows)
 */
export function detectPython(): { available: boolean; exe: string; version: string } {
  const candidates = process.platform === 'win32'
    ? ['python3', 'python', 'py']
    : ['python3', 'python'];

  for (const exe of candidates) {
    const resolved = resolveRealPython(exe);
    if (resolved) return { available: true, ...resolved };
  }
  return { available: false, exe: '', version: '' };
}

/** Windows ships a Store STUB named `python` that opens the Store instead of running. */
const WINDOWS_STORE_STUB = 'windowsapps';

/** `Python 3.12.1`, in the banner both stdout and stderr carry. */
const VERSION_BANNER = /^Python\s+(\d+\.\d+\.\d+)/;

/**
 * The path and version of a REAL Python found under this name, or null.
 *
 * Three ways a candidate is not a real Python, and each must be skipped rather than
 * reported: not on PATH, a Windows Store stub (which "exists" and even responds), or a
 * binary whose `--version` does not print a version banner.
 */
function resolveRealPython(exe: string): { exe: string; version: string } | null {
  const found = isToolAvailable(exe);
  if (!found.available) return null;
  if (found.path.toLowerCase().includes(WINDOWS_STORE_STUB)) return null;

  const version = versionOf(found.path);
  return version === null ? null : { exe: found.path, version };
}

/**
 * The version this binary reports, or null when it does not behave like Python.
 *
 * Both streams are read because some Pythons print their banner on stderr, and a run
 * that timed out or exited non-zero is not a Python this gate can use.
 */
function versionOf(exePath: string): string | null {
  const result = runTool(exePath, ['--version'], { timeoutMs: 3000 });
  if (result.exitCode !== 0 || result.timedOut) return null;
  const banner = (result.stdout + result.stderr).trim().match(VERSION_BANNER);
  return banner ? banner[1] : null;
}

/**
 * Check if Python version meets minimum requirement.
 */
export function checkPythonVersion(version: string, minVersion = '3.8.0'): boolean {
  const parts = version.split('.').map(Number);
  const minParts = minVersion.split('.').map(Number);
  for (let i = 0; i < VERSION_DEPTH; i++) {
    const verdict = compareAt(parts[i] || 0, minParts[i] || 0);
    if (verdict !== null) return verdict;
  }
  return true; // equal
}

/** How many version segments participate in the comparison. */
const VERSION_DEPTH = 3;

/**
 * The verdict for one version segment, or null when the two are equal.
 *
 * Compared from the MAJOR segment outward, so 3.10 > 3.9 -- a string comparison would
 * put `3.10` before `3.9` and reject a Python that is new enough.
 *
 * @returns true when `v` is newer, false when older, null when equal
 */
function compareAt(v: number, m: number): boolean | null {
  if (v > m) return true;
  if (v < m) return false;
  return null;
}

// ── pip Detection ──

/**
 * Check pip availability via <python-exe> -m pip (ensures consistency).
 */
export function detectPip(pythonExe: string): { available: boolean; version: string } {
  if (!pythonExe) return { available: false, version: '' };

  const result = runTool(pythonExe, ['-m', 'pip', '--version'], { timeoutMs: 5000 });
  if (result.exitCode !== 0) return { available: false, version: '' };

  const output = result.stdout.trim();
  const versionMatch = output.match(/pip\s+(\d+\.\d+(?:\.\d+)?)/);
  return {
    available: true,
    version: versionMatch ? versionMatch[1] : 'unknown',
  };
}

// ── Environment Detection ──

/**
 * Detect Python environment type.
 */
/** Environment variables that identify a managed Python, in precedence order. */
const ENV_MARKERS: Array<{ key: string; type: PythonHealthResult['environment']['type'] }> = [
  { key: 'CONDA_PREFIX', type: 'conda' },
  { key: 'CONDA_DEFAULT_ENV', type: 'conda' },
  { key: 'VIRTUAL_ENV', type: 'venv' },
];

/** Files that identify the project's Python manager, in precedence order. */
const FILE_MARKERS: Array<{ name: string; type: PythonHealthResult['environment']['type'] }> = [
  { name: 'uv.lock', type: 'uv' },
  { name: '.python-version', type: 'pyenv' },
  { name: '.venv', type: 'venv' },
];

/**
 * The manager identified by an environment variable, or null.
 *
 * Environment beats files: a shell that has ACTIVATED a venv is telling us what is
 * really running, while a config file only says what the project would like.
 */
function environmentFromEnv(env: NodeJS.ProcessEnv) {
  const marker = ENV_MARKERS.find((m) => env[m.key]);
  return marker ? { type: marker.type, path: env[marker.key] as string } : null;
}

/**
 * The manager identified by a marker file in `dir`, or null.
 *
 * The path for `.venv` is the directory itself, not the marker -- that is what a caller
 * would activate.
 */
function environmentFromFiles(dir: string, fsMod: typeof import('fs'), pathMod: typeof import('path')) {
  for (const marker of FILE_MARKERS) {
    const markerPath = pathMod.join(dir, marker.name);
    if (!fsMod.existsSync(markerPath)) continue;
    return { type: marker.type, path: marker.type === 'venv' ? markerPath : dir };
  }
  return null;
}

/** The manager a project directory declares, or null when unreadable or absent. */
function environmentFromProject(cwd: string) {
  try {
    return environmentFromFiles(cwd, require('fs'), require('path'));
  } catch {
    // A project directory that cannot be read does not make this a managed
    // environment; the caller falls back to the system default.
    return null;
  }
}

export function detectEnvironment(cwd?: string): { type: PythonHealthResult['environment']['type']; path: string | null } {
  return environmentFromEnv(process.env)
    || environmentFromProject(cwd || process.cwd())
    || { type: 'system', path: null };
}

// ── Tool Checking ──

/**
 * Check availability of Python tools using common.ts infrastructure.
 */
export function checkTools(pythonExe: string, cwd?: string): PythonHealthResult['tools'] {
  const tools: PythonHealthResult['tools'] = [];

  for (const name of PYTHON_REQUIRED_TOOLS) {
    const tool = checkPythonTool(name, pythonExe, cwd);
    tools.push({ ...tool, required: true });
  }

  for (const name of PYTHON_OPTIONAL_TOOLS) {
    const tool = checkPythonTool(name, pythonExe, cwd);
    tools.push({ ...tool, required: false });
  }

  return tools;
}

/** A tool version as printed by `--version`; the patch segment is optional. */
const TOOL_VERSION = /(\d+\.\d+(?:\.\d+)?)/;

/** The version a run printed, or 'unknown' when it printed none. */
function versionFrom(result: { stdout: string; stderr: string }): string {
  // Some tools print their banner on stderr, so both streams are read.
  const banner = (result.stdout + result.stderr).trim().match(TOOL_VERSION);
  return banner ? banner[1] : 'unknown';
}

/**
 * The tool's version via `<python> -m <tool> --version`, or null when that fails.
 *
 * Preferred over a bare `--version` because it runs the tool in the SAME interpreter the
 * gate will use -- a tool installed for a different Python would otherwise be reported
 * available and then fail at run time.
 */
function versionViaInterpreter(name: string, pythonExe: string, cwd?: string): string | null {
  if (!pythonExe) return null;
  const result = runTool(pythonExe, ['-m', name, '--version'], { timeoutMs: 5000, cwd });
  return result.exitCode === 0 ? versionFrom(result) : null;
}

/** `npx` is invoked through its own command line, not as a path. */
function isNpxPath(toolPath: string, name: string): boolean {
  return toolPath === `npx ${name}`;
}

/** The tool's version via its own executable, or null when it is not on PATH. */
function versionViaExecutable(name: string, cwd?: string): string | null {
  const tool = isToolAvailable(name, cwd);
  if (!tool.available) return null;
  const npx = isNpxPath(tool.path, name);
  const result = runTool(
    npx ? 'npx' : tool.path,
    npx ? ['-y', name, '--version'] : ['--version'],
    { timeoutMs: 5000, cwd },
  );
  return versionFrom(result);
}

function checkPythonTool(
  name: string,
  pythonExe: string,
  cwd?: string
): { name: string; available: boolean; version: string } {
  const version = versionViaInterpreter(name, pythonExe, cwd) ?? versionViaExecutable(name, cwd);
  return version === null
    ? { name, available: false, version: '' }
    : { name, available: true, version };
}

/**
 * Build the "never probed" tool list.
 *
 * The report SHAPE must not change when the probes are skipped: every tool is
 * still listed, just as not-probed rather than probed-and-missing. Returning an
 * empty array would be a silent lie to any consumer that counts tools.
 */
function unprobedTools(): PythonHealthResult['tools'] {
  const entry = (name: string, required: boolean) => ({ name, available: false, version: '', required });
  return [
    ...PYTHON_REQUIRED_TOOLS.map(n => entry(n, true)),
    ...PYTHON_OPTIONAL_TOOLS.map(n => entry(n, false)),
  ];
}

/**
 * Resolve the Python tool list, honouring the input short-circuit (#782, P0-A).
 *
 * Probing mypy/pytest/ruff/flake8/black costs ~2.6 s of subprocess starts
 * (measured on this machine: 547+550+291+807+394 ms) and tells you nothing about
 * a project with no Python in it. The signal question is free, so it goes first.
 */
function resolvePythonTools(
  pythonExe: string,
  cwd: string | undefined,
  pythonSignal: boolean,
): { tools: PythonHealthResult['tools']; missingRequired: PythonHealthResult['tools'] } {
  const tools = pythonSignal ? checkTools(pythonExe, cwd) : unprobedTools();
  return { tools, missingRequired: tools.filter(t => t.required && !t.available) };
}

// ── Main Health Check ──

/**
 * Check the Python version, pip, and virtualenv, appending an issue for each
 * one that is missing or below minimum.
 */
function inspectEnvironment(
  python: { exe: string; version: string },
  cwd: string | undefined,
  issues: string[],
): { pip: PythonHealthResult['pip']; environment: PythonHealthResult['environment'] } {
  if (!checkPythonVersion(python.version)) {
    issues.push(`Python ${python.version} < 3.8.0 minimum. Upgrade recommended.`);
  }

  const pip = detectPip(python.exe);
  if (!pip.available) {
    issues.push(`pip not available. Install: ${python.exe} -m ensurepip`);
  }

  const environment = detectEnvironment(cwd);
  if (environment.type === 'system') {
    issues.push('No virtual environment detected. Consider using venv/conda/uv.');
  }

  return { pip, environment };
}

/**
 * Run comprehensive Python environment health check.
 */
/**
 * The result for a machine with no Python at all.
 *
 * `toolProbesRan: false` is the load-bearing field: no tool COULD have been probed, and
 * reporting an empty tool list without that flag reads as "everything is installed".
 */
function pythonMissing(): PythonHealthResult {
  return {
    healthy: false,
    python: { available: false, exe: '', version: '' },
    pip: { available: false, version: '' },
    environment: { type: 'system', path: null },
    tools: [],
    issues: ['Python 3 not found. Install from https://python.org/downloads'],
    toolProbesRan: false,
  };
}

export function checkPythonHealth(cwd?: string): PythonHealthResult {
  const issues: string[] = [];

  // 1. Detect Python
  const python = detectPython();
  if (!python.available) return pythonMissing();

  // 2-4. Version, pip, and virtualenv — each appends its own issue if unhappy.
  const { pip, environment } = inspectEnvironment(python, cwd, issues);

  // 5. Check tools (input short-circuit — see resolvePythonTools)
  const pythonSignal = hasPythonSignal(cwd);
  const { tools, missingRequired } = resolvePythonTools(python.exe, cwd, pythonSignal);

  reportMissingTools(issues, missingRequired, python.exe, pythonSignal);
  return {
    healthy: isHealthy(issues, missingRequired, pythonSignal),
    python, pip, environment, tools, issues,
    toolProbesRan: pythonSignal,
  };
}

/**
 * Note the required tools that are absent, but only on a PYTHON project.
 *
 * On a non-Python repo the tools are unknown-and-irrelevant, and telling a TS project to
 * install mypy is noise.
 */
function reportMissingTools(issues: string[], missingRequired: Array<{ name: string }>, exe: string, pythonSignal: boolean): void {
  if (missingRequired.length === 0 || !pythonSignal) return;
  const names = missingRequired.map((t) => t.name).join(', ');
  issues.push(`Required tools missing: ${names}. Install: ${exe} -m pip install ${names}`);
}

/** Issues that describe a BROKEN install rather than a missing optional convenience. */
const BLOCKING_ISSUE = /not found|minimum/;

/**
 * The overall verdict.
 *
 * `missingRequired` counts only when the tools were actually PROBED. Counting them
 * unconditionally would report "unhealthy" for a repo with nothing for Python tooling
 * to check.
 */
function isHealthy(issues: string[], missingRequired: unknown[], pythonSignal: boolean): boolean {
  if (issues.some((issue) => BLOCKING_ISSUE.test(issue))) return false;
  return !pythonSignal || missingRequired.length === 0;
}

// ── CLI Entry Point ──

if (process.argv.includes('--run')) {
  const cwdIdx = process.argv.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
  const result = checkPythonHealth(cwd);

  console.log('');
  console.log('━━━ Python Environment Health Check ━━━');
  console.log('');
  console.log(`  Python:    ${result.python.available ? `✅ ${result.python.exe} (${result.python.version})` : '❌ Not found'}`);
  console.log(`  pip:       ${result.pip.available ? `✅ ${result.pip.version}` : '❌ Not available'}`);
  console.log(`  Env:       ${result.environment.type}${result.environment.path ? ` (${result.environment.path})` : ''}`);
  console.log('');

  if (result.tools.length > 0) {
    const probed = result.toolProbesRan;
    console.log(probed ? '  Tools:' : '  Tools: (not probed — no Python signal in this project)');
    for (const t of result.tools) {
      const icon = probed ? (t.available ? '✅' : (t.required ? '❌' : '⚠️')) : '·';
      const req = t.required ? '(required)' : '(optional)';
      const state = probed ? (t.available ? t.version : 'not installed') : 'skipped';
      console.log(`    ${icon} ${t.name} ${state} ${req}`);
    }
    console.log('');
  }

  if (result.issues.length > 0) {
    console.log('  Issues:');
    result.issues.forEach(i => console.log(`    ⚠️  ${i}`));
    console.log('');
  }

  if (result.healthy) {
    console.log('  ✅ Python environment is healthy.');
  } else {
    console.log('  ❌ Python environment has issues.');
  }

  process.exit(result.healthy ? 0 : 1);
}
