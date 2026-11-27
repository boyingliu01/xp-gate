import { runNpm, which, run } from './proc.mjs';
import { semverOf } from './version.mjs';

/**
 * Asking each package manager what version is installed, and what is newest.
 *
 * Split out of `tools.mjs` (Gate 4: 18 exports, maximum 10). Everything here
 * shells out to one ecosystem's CLI or fetches one registry's JSON; how those
 * answers are COMBINED into a report row is a different job and stays in
 * `tools.mjs`.
 *
 * The `deps` injection that used to be shared is still shared: each exported
 * function takes the lookups it needs, so a test can fake one ecosystem without
 * touching the others.
 */

/**
 * Budget for installing a global package, shared by the npm and pip paths.
 *
 * These two carried the same bare 600000: one intent copied twice, so fixing a
 * slow install on one side left the other behind. Unlike the lookup timeouts in
 * proc.mjs (which are separate decisions that happen to share a number), this
 * really is one budget for one kind of operation.
 */
export const PACKAGE_INSTALL_TIMEOUT_MS = 600000;

export function npmLatest(pkg, runNpmImpl = runNpm) {
  const r = runNpmImpl(['view', pkg, 'version'], { timeout: 30000 });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

export function pythonBin(whichImpl = which) {
  return whichImpl('python') || whichImpl('python3') || whichImpl('py');
}

/**
 * 已装版本走本地元数据（毫秒级）。`pip list --outdated` 会逐个包访问 PyPI，
 * 实测在本机超过 120s，不能放在验收路径上。
 */
export function pipShowVersion(pkg, findPython = pythonBin, spawn = run) {
  const py = findPython();
  if (!py) return '';
  return versionField(spawn(py, ['-m', 'pip', 'show', pkg], { timeout: 30000 }));
}

/** The `Version:` value of a `pip show` result, or '' when it did not answer. */
function versionField(result) {
  if (result.status !== 0) return '';
  const m = String(result.stdout || '').match(/^Version:\s*(\S+)/m);
  return m ? m[1] : '';
}

/** The `pkg (1.2.3)` value of a `pip index versions` result, or null. */
function indexVersionField(result) {
  if (result.status !== 0) return null;
  const m = String(result.stdout || '').match(/^[^\s()]+\s+\(([^)]+)\)/m);
  return m ? semverOf(m[1]) : null;
}

/**
 * checkov 的 PyPI JSON 体积达数十 MB，8s 内拉不完；`pip index versions` 只回
 * 一个短响应，先走它，失败再退回 PyPI JSON。
 */
export async function pipLatest(pkg, deps = {}) {
  const d = { ...PIP_LATEST_DEPS, ...deps };
  const py = d.pythonBin();
  if (!py) return d.pypiLatest(pkg);
  const found = indexVersionField(d.run(py, ['-m', 'pip', 'index', 'versions', pkg], { timeout: 45000 }));
  return found ?? d.pypiLatest(pkg);
}

/**
 * The lookups `pipLatest` can reach, as data.
 *
 * Written as a table because spelling them as `deps.x || realX` cost three
 * branches each and pushed this function to CCN 7, over the project's ceiling of
 * 5. Adding a seam now costs a row instead of a branch.
 */
const PIP_LATEST_DEPS = { pythonBin, run, pypiLatest };

export async function fetchJsonVersion(url, timeoutMs, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': 'reinstall-xp-gate' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function pypiLatest(pkg, fetchImpl = fetch) {
  const payload = await fetchJsonVersion(`https://pypi.org/pypi/${pkg}/json`, 8000, fetchImpl);
  return payload ? semverOf(payload.info?.version || '') : '';
}

export async function githubLatest(repo, fetchImpl = fetch) {
  const payload = await fetchJsonVersion(`https://api.github.com/repos/${repo}/releases/latest`, 6000, fetchImpl);
  return payload ? semverOf(payload.tag_name || '') : '';
}
