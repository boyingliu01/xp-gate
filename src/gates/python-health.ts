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
function walkForPythonFile(dir: string, depth: number, counter: { seen: number }): boolean {
  if (depth > SIGNAL_MAX_DEPTH || counter.seen > SIGNAL_MAX_ENTRIES) return false;
  let entries: import('fs').Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    counter.seen += 1;
    if (counter.seen > SIGNAL_MAX_ENTRIES) return false;
    if (isPythonFileEntry(entry)) return true;
    if (entry.isDirectory() && !shouldSkipDir(entry) && walkForPythonFile(path.join(dir, entry.name), depth + 1, counter)) {
      return true;
    }
  }
  return false;
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
    // Check if executable exists
    const whichCheck = isToolAvailable(exe);
    if (!whichCheck.available) continue;

    const exePath = whichCheck.path;

    // Filter Windows Store stubs (heuristic: path contains WindowsApps)
    if (exePath.toLowerCase().includes('windowsapps')) continue;

    // Verify it's a real Python (not a stub that opens Store)
    const verResult = runTool(exePath, ['--version'], { timeoutMs: 3000 });
    if (verResult.exitCode !== 0 || verResult.timedOut) continue;

    const output = (verResult.stdout + verResult.stderr).trim();
    const versionMatch = output.match(/^Python\s+(\d+\.\d+\.\d+)/);
    if (!versionMatch) continue;

    return { available: true, exe: exePath, version: versionMatch[1] };
  }

  return { available: false, exe: '', version: '' };
}

/**
 * Check if Python version meets minimum requirement.
 */
export function checkPythonVersion(version: string, minVersion = '3.8.0'): boolean {
  const parts = version.split('.').map(Number);
  const minParts = minVersion.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const v = parts[i] || 0;
    const m = minParts[i] || 0;
    if (v > m) return true;
    if (v < m) return false;
  }
  return true; // equal
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
export function detectEnvironment(cwd?: string): { type: PythonHealthResult['environment']['type']; path: string | null } {
  const env = process.env;

  // conda
  if (env.CONDA_PREFIX) return { type: 'conda', path: env.CONDA_PREFIX };
  if (env.CONDA_DEFAULT_ENV) return { type: 'conda', path: env.CONDA_DEFAULT_ENV };

  // venv / virtualenv
  if (env.VIRTUAL_ENV) return { type: 'venv', path: env.VIRTUAL_ENV };

  // uv
  const dir = cwd || process.cwd();
  try {
    const fs = require('fs');
    const path = require('path');
    if (fs.existsSync(path.join(dir, 'uv.lock'))) return { type: 'uv', path: dir };
    if (fs.existsSync(path.join(dir, '.python-version'))) return { type: 'pyenv', path: dir };
    if (fs.existsSync(path.join(dir, '.venv'))) return { type: 'venv', path: path.join(dir, '.venv') };
  } catch { /* ignore */ }

  return { type: 'system', path: null };
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

function checkPythonTool(
  name: string,
  pythonExe: string,
  cwd?: string
): { name: string; available: boolean; version: string } {
  // Try via <python-exe> -m <tool> --version first (ensures correct env)
  if (pythonExe) {
    const result = runTool(pythonExe, ['-m', name, '--version'], { timeoutMs: 5000, cwd });
    if (result.exitCode === 0) {
      const output = (result.stdout + result.stderr).trim();
      const versionMatch = output.match(/(\d+\.\d+(?:\.\d+)?)/);
      return { name, available: true, version: versionMatch ? versionMatch[1] : 'unknown' };
    }
  }

  // Fallback: direct tool detection via common.ts
  const tool = isToolAvailable(name, cwd);
  if (tool.available) {
    const verResult = runTool(tool.path === `npx ${name}` ? 'npx' : tool.path,
      tool.path === `npx ${name}` ? ['-y', name, '--version'] : ['--version'],
      { timeoutMs: 5000, cwd });
    const output = (verResult.stdout + verResult.stderr).trim();
    const versionMatch = output.match(/(\d+\.\d+(?:\.\d+)?)/);
    return { name, available: true, version: versionMatch ? versionMatch[1] : 'unknown' };
  }

  return { name, available: false, version: '' };
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
export function checkPythonHealth(cwd?: string): PythonHealthResult {
  const issues: string[] = [];

  // 1. Detect Python
  const python = detectPython();
  if (!python.available) {
    issues.push('Python 3 not found. Install from https://python.org/downloads');
    return {
      healthy: false,
      python,
      pip: { available: false, version: '' },
      environment: { type: 'system', path: null },
      tools: [],
      issues,
      // Python itself is absent, so no tool could have been probed.
      toolProbesRan: false,
    };
  }

  // 2-4. Version, pip, and virtualenv — each appends its own issue if unhappy.
  const { pip, environment } = inspectEnvironment(python, cwd, issues);

  // 5. Check tools (input short-circuit — see resolvePythonTools)
  const pythonSignal = hasPythonSignal(cwd);
  const { tools, missingRequired } = resolvePythonTools(python.exe, cwd, pythonSignal);

  // Only report missing tools when the project is actually Python — otherwise this
  // is a non-signal, and telling a TS project to install mypy is noise.
  if (missingRequired.length > 0 && pythonSignal) {
    const names = missingRequired.map(t => t.name).join(', ');
    issues.push(`Required tools missing: ${names}. Install: ${python.exe} -m pip install ${names}`);
  }

  // `missingRequired` counts only when it was actually PROBED. On a non-Python
  // project the tools are unknown-and-irrelevant, not missing: counting them would
  // report "unhealthy" for a repo that has nothing for Python tooling to check.
  const healthy = issues.filter(i => i.includes('not found') || i.includes('minimum')).length === 0
    && (!pythonSignal || missingRequired.length === 0);

  return { healthy, python, pip, environment, tools, issues, toolProbesRan: pythonSignal };
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
