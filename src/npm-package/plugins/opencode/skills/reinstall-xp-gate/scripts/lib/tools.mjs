import { runNpm, toolVersion, which, run } from './proc.mjs';
import { semverOf, cmpVersion } from './version.mjs';
import {
  PACKAGE_INSTALL_TIMEOUT_MS,
  npmLatest,
  pythonBin,
  pipShowVersion,
  pipLatest,
  pypiLatest,
  githubLatest,
} from './probes.mjs';

/**
 * Classifying the gate tools: what is installed, what is newest, what to do.
 *
 * Gate 4 flagged this module for owning 18 exports against a maximum of 10. The
 * count came from three jobs living together -- parsing versions, asking each
 * package manager for one, and combining the answers into a report. The first
 * two moved to `version.mjs` and `probes.mjs`; this file keeps the orchestration
 * and the report rows, which is what `verify` and `reinstall` actually want.
 */

export const TOOLS = [
  { name: 'jscpd', kind: 'npm', pkg: 'jscpd' },
  { name: 'lizard', kind: 'pip', pkg: 'lizard' },
  { name: 'checkov', kind: 'pip', pkg: 'checkov' },
  { name: 'hadolint', kind: 'binary', repo: 'hadolint/hadolint' },
  { name: 'gitleaks', kind: 'binary', repo: 'gitleaks/gitleaks' },
  { name: 'semgrep', kind: 'pip', pkg: 'semgrep' },
  { name: 'npx', kind: 'node' },
  { name: 'jq', kind: 'binary', repo: 'jqlang/jq' },
];

/**
 * Fill the version/path of a pip-managed tool from whichever source answers.
 *
 * `deps` carries the same lookups `detect` received. Without threading them
 * through, injecting `toolVersion` at the top still let this function call the
 * real one -- each test then paid a live `which python` round trip, which is
 * how a supposedly isolated unit test took 5-7 s.
 */
export function pipProbe(spec, row, deps = {}) {
  const d = resolveDeps(deps);
  const shown = d.pipShowVersion(spec.pkg, d.pythonBin);
  const probe = d.toolVersion(spec.name);
  if (!shown && !probe.path) return;
  row.present = true;
  row.version = pipVersion(shown, probe.version);
  row.path = pipPath(shown, probe.path, spec.pkg);
}

/**
 * pip's own metadata wins over the version banner when both answered: the banner
 * is a tool-specific string, the metadata is the installed distribution version.
 * A binary's version is kept raw because it may be unparseable by design.
 */
function pipVersion(shown, probed) {
  if (shown) return semverOf(shown);
  return semverOf(probed) || probed;
}

/** A venv install is not on PATH, so the path has to say how to reach it. */
function pipPath(shown, probedPath, pkg) {
  if (!shown) return probedPath;
  return probedPath || `python -m pip show ${pkg}`;
}

/**
 * Every external effect the probe layer can reach, resolved once.
 *
 * Spreading `deps.x || realX` through each function made every signature carry
 * its own fallback chain, which pushed six of them past the CCN 5 ceiling
 * (measured: pipLatest 9, pipProbe 9, latestFor 8, pipShowVersion 7, detect 7,
 * upgraders 6). Filling the gaps in one place keeps each probe a straight-line
 * read of `deps` and restores the complexity budget.
 *
 * The table is data rather than a chain of `||` so adding a seam costs a row,
 * not a branch: written as a chain this function alone measured CCN 15.
 *
 * Production passes nothing, so every field is the real implementation and
 * behaviour is unchanged; tests pass only the fields they want to fake.
 */

const DEFAULT_DEPS = {
  toolVersion,
  pipProbe,
  pipShowVersion,
  pythonBin,
  run,
  runNpm,
  npmLatest,
  pipLatest,
  githubLatest,
  pypiLatest,
  fetchImpl: fetch,
  lookup: latestFor,
  log: (msg) => console.log(msg),
};

function resolveDeps(deps = {}) {
  const resolved = { ...DEFAULT_DEPS };
  for (const [key, value] of Object.entries(deps)) {
    if (value !== undefined) resolved[key] = value;
  }
  return resolved;
}

/**
 * Probe one tool spec into a report row.
 *
 * `deps` exists so the probe can be exercised without real tools on PATH:
 * `toolVersion` shells out via `proc.mjs`, whose bindings are fixed at module
 * load and cannot be swapped by a test. Injecting the lookups keeps the
 * production default identical while making every branch reachable.
 */
export function detect(spec, deps = {}) {
  const d = resolveDeps(deps);
  const row = { ...spec, path: '', present: false, version: '', latest: '', status: 'ok' };
  if (spec.kind === 'pip') {
    d.pipProbe(spec, row, deps);
    return row;
  }
  const probe = d.toolVersion(spec.name);
  row.present = Boolean(probe.path);
  row.path = probe.path;
  row.version = spec.kind === 'binary' ? probe.version : semverOf(probe.version) || probe.version;
  return row;
}

/**
 * Best known release for a tool, or '' when the lookup is unavailable.
 *
 * Every branch reaches the network or spawns a package manager, so the three
 * sources are injectable. Without that seam none of them is testable, which is
 * how this function reached 25% function coverage while carrying the decision
 * that turns a tool row into 'outdated'.
 */
export async function latestFor(row, deps = {}) {
  const d = resolveDeps(deps);
  const source = { npm: d.npmLatest, pip: d.pipLatest, binary: d.githubLatest }[row.kind];
  if (!source) return '';
  const raw = row.kind === 'npm' ? source(row.pkg) : await source(row.kind === 'pip' ? row.pkg : row.repo);
  return semverOf(raw);
}

/**
 * Classify one row. `node` (npx) has no independent version to compare, so it
 * is 'ok' whenever it resolves -- calling it 'unverified' every run would add a
 * permanent WARN that trains the operator to ignore the column.
 */
export async function classify(row, lookup = latestFor) {
  if (!row.present) {
    row.status = 'missing';
    return row;
  }
  row.latest = await lookup(row);
  row.status = statusOf(row);
  return row;
}

/**
 * The verdict for one probed row.
 *
 * Split out and exported because it is the whole decision and it has three
 * outcomes that are easy to collapse: a tool that is absent ('missing'), one
 * whose latest version could not be fetched ('unverified'), and one that is
 * genuinely behind ('outdated'). Reporting the middle case as 'ok' would say a
 * tool is current when nothing was compared -- the same silent pass this
 * project exists to avoid. `node` is the documented exception: it has no
 * independent version to compare against, so a permanent 'unverified' would be
 * noise rather than information.
 */
export function statusOf(row) {
  if (row.latest) return cmpVersion(row.version, row.latest) < 0 ? 'outdated' : 'ok';
  return row.kind === 'node' ? 'ok' : 'unverified';
}

/** 8 个门禁 CLI 的存在性 + 版本 + 可达最新。 */
export async function toolReport(deps = {}) {
  const d = resolveDeps(deps);
  const rows = TOOLS.map((spec) => detect(spec, d));
  // Not `rows.map(classify)`: map passes (value, index, array), so the index
  // lands in the `lookup` parameter and every call dies with "lookup is not a
  // function". The default only applies when the argument is undefined.
  await Promise.all(rows.map((row) => classify(row, d.lookup)));
  return rows;
}

/** `install -g <pkg>@latest` through npm; the exit code is the verdict. */
function upgradeNpm(row, d) {
  const r = d.runNpm(['install', '-g', `${row.pkg}@latest`], { stdio: 'inherit', timeout: PACKAGE_INSTALL_TIMEOUT_MS });
  return r.status ?? 1;
}

/** `pip install -U <pkg>`; without an interpreter there is nothing to run. */
function upgradePip(row, d) {
  const py = d.pythonBin();
  if (!py) return 1;
  const r = d.run(py, ['-m', 'pip', 'install', '-U', row.pkg], { stdio: 'inherit', timeout: PACKAGE_INSTALL_TIMEOUT_MS });
  return r.status ?? 1;
}

/**
 * 二进制工具没有统一的包管理器入口，只提示，不擅自下载覆盖用户的 PATH。
 */
function upgradeBinary(row, d) {
  d.log(`  ${row.name}: 二进制工具，请从 ${row.repo || '官方 release'} 手动升级到 ${row.latest || '最新版'}`);
  return 0;
}

/**
 * 各 kind 的升级方式。表驱动而不是 if-链：原来是三分支嵌套，
 * 加一种 kind 就要再嵌一层，而现在只需要加一行。
 *
 * 每条分支都通过 `deps` 注入以便测试：它们真的会执行全局安装，
 * 在测试里跑一次就会改动开发机的工具链。
 */
const UPGRADERS = { npm: upgradeNpm, pip: upgradePip, binary: upgradeBinary };

export function upgradeTool(row, deps = {}) {
  const upgrade = UPGRADERS[row.kind];
  return upgrade ? upgrade(row, resolveDeps(deps)) : 0;
}

// Implementation moved to `version.mjs` and `probes.mjs`; re-exported so the
// existing import sites keep working and `tools.mjs` stays the one place to ask
// about gate tools.
export { semverOf, cmpVersion } from './version.mjs';
export {
  PACKAGE_INSTALL_TIMEOUT_MS,
  npmLatest,
  pythonBin,
  pipShowVersion,
  pipLatest,
  fetchJsonVersion,
  pypiLatest,
  githubLatest,
} from './probes.mjs';
