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

// ── Types ──

export interface PythonHealthResult {
  healthy: boolean;
  python: { available: boolean; version: string; exe: string };
  pip: { available: boolean; version: string };
  environment: { type: 'system' | 'venv' | 'conda' | 'pyenv' | 'uv'; path: string | null };
  tools: Array<{ name: string; available: boolean; version: string; required: boolean }>;
  issues: string[];
}

// ── Python Tool Registry (sync with language-tools.js LANGUAGE_REGISTRY.python) ──

const PYTHON_REQUIRED_TOOLS = ['mypy', 'pytest'];
const PYTHON_OPTIONAL_TOOLS = ['ruff', 'flake8', 'black'];

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

// ── Main Health Check ──

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
    };
  }

  // 2. Check version
  if (!checkPythonVersion(python.version)) {
    issues.push(`Python ${python.version} < 3.8.0 minimum. Upgrade recommended.`);
  }

  // 3. Detect pip
  const pip = detectPip(python.exe);
  if (!pip.available) {
    issues.push(`pip not available. Install: ${python.exe} -m ensurepip`);
  }

  // 4. Detect environment
  const environment = detectEnvironment(cwd);
  if (environment.type === 'system') {
    issues.push('No virtual environment detected. Consider using venv/conda/uv.');
  }

  // 5. Check tools
  const tools = checkTools(python.exe, cwd);
  const missingRequired = tools.filter(t => t.required && !t.available);
  if (missingRequired.length > 0) {
    const names = missingRequired.map(t => t.name).join(', ');
    issues.push(`Required tools missing: ${names}. Install: ${python.exe} -m pip install ${names}`);
  }

  const healthy = issues.filter(i => i.includes('not found') || i.includes('minimum')).length === 0
    && missingRequired.length === 0;

  return { healthy, python, pip, environment, tools, issues };
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
    console.log('  Tools:');
    for (const t of result.tools) {
      const icon = t.available ? '✅' : (t.required ? '❌' : '⚠️');
      const req = t.required ? '(required)' : '(optional)';
      console.log(`    ${icon} ${t.name} ${t.available ? t.version : 'not installed'} ${req}`);
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
