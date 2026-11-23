/**
 * Tool audit — completeness, VALIDITY and uniqueness for every gate tool.
 *
 * WHY THIS MODULE EXISTS (2026-11-23)
 * -----------------------------------
 * Two commands already probed tools, and neither could answer the question
 * "is my tool set complete, valid and unique":
 *
 *   - `check-tools` only probes tools belonging to languages detected in the
 *     CURRENT project. A Go or Swift tool that is broken stays invisible.
 *   - `doctor` only probes its own eight cross-language CLI entries.
 *
 * Neither merged the other, so the union was never checked as a set, and
 * neither could see that a single tool was installed more than once.
 *
 * DEFECTS FOUND ON THIS MACHINE, PINNED BY THE TESTS
 * --------------------------------------------------
 *   1. VALIDITY false positive — `psscriptanalyzer` is probed with
 *      `pwsh -Command "Get-Module -ListAvailable PSScriptAnalyzer"`, which exits 0
 *      with EMPTY output when the module is absent. An exit-code-only probe then
 *      reports "available" for a tool that cannot run. Verified on this box:
 *      the probe exits 0 and prints nothing, while `Invoke-ScriptAnalyzer` is
 *      ABSENT. "Not checked" masquerading as "passed" is this project's most
 *      repeated defect family, so the probe contract here is:
 *      non-zero exit OR empty output => not available, with a reason.
 *
 *   2. UNIQUENESS — `hadolint` existed as two byte-identical 54 MB binaries and
 *      `archlint` as an old 0.16.0 binary shadowing a newer npm install. The
 *      second is the "stale copy shadows the fresh one" trap: the gate runs the
 *      old binary and nobody notices.
 *
 * DESIGN: audit reports, install-tools repairs.
 * A check that also repairs cannot be used to decide whether repair is needed,
 * and a report that mutates the machine cannot be re-run to compare. The two
 * responsibilities are therefore kept in separate modules on purpose.
 */

const { execFile, execFileSync } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);
const fs = require('fs');
const path = require('path');

/** Probe timeout — a gate tool that cannot answer in this window is unusable. */
const PROBE_TIMEOUT_MS = 15000;

/**
 * Paths owned by the distribution.
 *
 * A copy here is the SYSTEM's, not an extra install: `/usr/bin/jq` and
 * `~/.local/bin/jq` coexisting is the normal shape after `apt install jq` plus a
 * newer user copy, and `npm` ships npx for BOTH the distro node and an nvm node.
 * Counting those as "duplicate installs" would push people to delete a distro
 * package or a second runtime — both destructive, neither a repair.
 */
const SYSTEM_PATH_PREFIXES = ['/usr/bin/', '/bin/', '/usr/sbin/', '/sbin/'];

/**
 * Runtime-owned trees are the same story as distro paths: nvm keeps its own npm,
 * so `npx` exists once per node runtime by construction, and a system node adds
 * another. None of those is "installed twice by mistake".
 */
const RUNTIME_PATH_PATTERNS = [/\/\.nvm\/versions\/node\/[^/]+\//, /\/\.n\/versions\/node\/[^/]+\//];

/** Owned by a runtime manager rather than by the user's own install choice. */
function isRuntimePath(p) {
  return RUNTIME_PATH_PATTERNS.some((re) => re.test(String(p)));
}

/** Is this resolved path owned by the distribution rather than the user? */
function isSystemPath(p) {
  return SYSTEM_PATH_PREFIXES.some((pre) => String(p).startsWith(pre)) || isRuntimePath(p);
}

/**
 * Extract an `x.y.z` (or `x.y`) version from a tool's banner output.
 *
 * Real banners this must survive (all observed on this machine):
 *   "Haskell Dockerfile Linter 2.14.0"   "gitleaks version 8.30.1"
 *   "jq-1.8.2"                            "v10.15.0"
 *   "ShellCheck - shell script analysis tool\nversion: 0.10.0"
 *
 * @param {string} text
 * @returns {string|null} the version, or null when no digits are present
 */
function parseVersion(text) {
  if (typeof text !== 'string') return null;
  // Prefer a `version:`-labelled token, then the first dotted number.
  const labelled = text.match(/version:?\s*v?(\d+\.\d+(?:\.\d+)*)/i);
  if (labelled) return labelled[1];
  const first = text.match(/\bv?(\d+\.\d+(?:\.\d+)*)/);
  return first ? first[1] : null;
}

/**
 * Compare two dotted versions numerically.
 *
 * Lexical comparison is wrong in a way that hides real upgrades: "1.10.0" <
 * "1.9.0" lexically, so a current tool reads as outdated and an outdated one
 * reads as current.
 *
 * @returns {number} negative when a < b, 0 when equal, positive when a > b
 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/**
 * Default probe: run the tool's own check command and capture both streams.
 *
 * The command is executed through `/bin/sh -c` (or `cmd.exe` on Windows) because
 * registry entries are shell snippets, not argv arrays.
 *
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function defaultRunProbe(checkCmd) {
  const isWindows = process.platform === 'win32';
  try {
    const stdout = execFileSync(isWindows ? 'cmd.exe' : '/bin/sh', [
      isWindows ? '/c' : '-c',
      checkCmd,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PROBE_TIMEOUT_MS,
    });
    return { status: 0, stdout: String(stdout || ''), stderr: '' };
  } catch (err) {
    return {
      status: typeof err.status === 'number' ? err.status : 1,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || err.message || ''),
    };
  }
}

/**
 * Default locator: every PATH hit for a command, in resolution order.
 *
 * Duplicates are a PATH fact, so the audit must look at the WHOLE PATH rather
 * than the first hit — resolving only the first is exactly how a stale copy
 * shadows a fresh one without being seen.
 */
function defaultLocate(name) {
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'where' : 'which -a';
  try {
    const out = execFileSync(isWindows ? 'cmd.exe' : '/bin/sh', [
      isWindows ? '/c' : '-c',
      `${cmd} ${name}`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: PROBE_TIMEOUT_MS });
    return String(out || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * Async counterpart of `defaultRunProbe`.
 *
 * MEASURED WHY THIS EXISTS (2026-11-23): probed serially through execFileSync,
 * `checkov --version` (1.9 s) and `semgrep --version` (1.4 s) blocked the event
 * loop for ~3.6 s inside doctor. Every sibling probe in the same process then
 * missed its 1.5 s budget and `node --version` / `git --version` were reported as
 * "Not found" on a machine where they answer in 5 ms. A slow TOOL must never be
 * able to make a FAST tool look absent.
 */
async function defaultRunProbeAsync(checkCmd) {
  const isWindows = process.platform === 'win32';
  try {
    const { stdout, stderr } = await execFileAsync(
      isWindows ? 'cmd.exe' : '/bin/sh',
      [isWindows ? '/c' : '-c', checkCmd],
      { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS },
    );
    return { status: 0, stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (err) {
    return {
      status: typeof err.status === 'number' ? err.status : 1,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || err.message || ''),
    };
  }
}

/** Resolve a path to its real target so symlink chains collapse to one entity. */
function defaultRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Run the tool's probe and decide VALIDITY.
 *
 * Split out of `auditTool` because the validity contract is the part that
 * regressed before, and it deserves to be readable on its own:
 * a probe is proof of availability only when it exits 0 AND prints something.
 */
async function probeValidityAsync(checkCmd, runProbe) {
  const result = runProbe(checkCmd);
  // Await a thenable so a concurrent caller keeps the loop free; a sync probe
  // (execFileSync) still works, which keeps the old call sites valid.
  const awaited = result && typeof result.then === 'function' ? await result : result;
  return interpretProbe(awaited, '');
}

/**
 * The ONE validity rule, shared by the sync and async probe paths.
 *
 * Split out because the rule regressed once already: two copies would let the
 * async path accept something the sync path rejects, and the difference would
 * show up as "doctor says missing, check-tools says fine".
 */
function interpretProbe(probe, thrown) {
  const safeProbe = probe || { status: 1, stdout: '', stderr: thrown || '' };
  const stdout = String((safeProbe && safeProbe.stdout) || '');
  const stderr = String((safeProbe && safeProbe.stderr) || '');
  const combined = `${stdout}\n${stderr}`.trim();
  const exitedClean = safeProbe.status === 0;
  const hasOutput = combined.replace(/\s+/g, '').length > 0;
  const available = exitedClean && hasOutput;

  let reason = '';
  if (!available) {
    if (thrown) reason = `probe failed: ${thrown}`;
    else if (exitedClean) reason = 'probe printed no output (empty output cannot prove availability)';
    else reason = `probe exited ${safeProbe.status}`;
  }

  return { available, reason, output: combined };
}

function probeValidity(checkCmd, runProbe) {
  let probe;
  let thrown = '';
  try {
    probe = runProbe(checkCmd);
  } catch (err) {
    // Keep the thrown message: "probe exited 1" alone cannot distinguish a
    // timeout from a missing interpreter, and both need different fixes.
    thrown = String(err && err.message ? err.message : err);
    probe = { status: 1, stdout: '', stderr: thrown };
  }
  return interpretProbe(probe, thrown);
}

/**
 * Decide currency from installed vs latest.
 *
 * "Unknown" is deliberately distinct from "current": a tool whose latest
 * version could not be determined has not been shown to be up to date.
 */
function classifyCurrency(available, installedVersion, latestVersion) {
  if (!available) return { currency: 'missing', outdated: null };
  if (!latestVersion || !installedVersion) return { currency: 'unknown', outdated: null };
  const isOld = compareVersions(installedVersion, latestVersion) < 0;
  return { currency: isOld ? 'outdated' : 'current', outdated: isOld };
}

/**
 * Audit ONE tool across validity, uniqueness and currency.
 *
 * @param {{name: string, checkCmd: string}} toolDef
 * @param {{
 *   runProbe?: (cmd: string) => {status: number, stdout: string, stderr: string},
 *   locate?: (name: string) => string[],
 *   realpath?: (p: string) => string,
 *   latestVersion?: string|null,
 * }} [deps] injectable for tests
 */
/**
 * Classify a tool's copies into duplicates vs coexistence.
 *
 * Shared by the sync and async paths so the judgement cannot differ between
 * `check-tools` and `doctor` — a difference there would read as one command
 * lying about the other.
 */
function classifyCopies(distinctRealPaths) {
  const systemCopies = distinctRealPaths.filter(isSystemPath);
  const userCopies = distinctRealPaths.filter((p) => !isSystemPath(p));
  const duplicated = userCopies.length > 1;
  return {
    systemCopies,
    userCopies,
    duplicated,
    coexistingCopies: !duplicated && userCopies.length > 0 && systemCopies.length > 0,
  };
}

/**
 * Assemble one audit row.
 *
 * Both probe paths funnel through here: the row's shape is part of the contract
 * (`check-tools --json`, doctor's report), so building it in two places is how a
 * field goes missing from one of them.
 */
function buildRow(toolDef, { paths, distinctRealPaths, validity, latestVersion }) {
  const { available, reason, output } = validity;
  const installedVersion = available ? parseVersion(output) : null;
  const { currency, outdated } = classifyCurrency(available, installedVersion, latestVersion);
  const copies = classifyCopies(distinctRealPaths);

  return {
    name: toolDef.name,
    available,
    validityReason: reason,
    // A tool probed through `npx --no-install` has no standalone executable on
    // PATH (archlint, dependency-cruiser); `which -a` finding nothing is NOT
    // evidence of absence.
    npxInvoked: /\bnpx\b/.test(String(toolDef.checkCmd || '')),
    paths,
    distinctRealPaths,
    duplicated: copies.duplicated,
    coexistingCopies: copies.coexistingCopies,
    systemCopies: copies.systemCopies,
    userCopies: copies.userCopies,
    // `version` is the banner line as reported; `installedVersion` is the parsed
    // semver used for comparison. Keeping both means a report can show what the
    // tool actually printed AND what the audit decided from it.
    version: available ? output.split('\n')[0] : null,
    installedVersion,
    latestVersion: latestVersion || null,
    outdated,
    currency,
    gates: toolDef.gates || [],
    optional: Boolean(toolDef.optional),
    // Carried through so a report can still say WHICH language needs this tool.
    // Dropping it made every row look cross-language, which silently emptied
    // the per-language groups (#468 contract).
    languages: toolDef.languages || [],
  };
}

/** Resolve `latestVersion`, treating any lookup failure as "cannot determine". */
function latestFor(toolDef, deps) {
  if (Object.prototype.hasOwnProperty.call(deps, 'latestVersion')) return deps.latestVersion;
  return null;
}

function auditTool(toolDef, deps = {}) {
  const locate = deps.locate || defaultLocate;
  const realpath = deps.realpath || defaultRealpath;

  // Duplicates are a PATH fact: look at every hit, never just the first.
  const paths = locate(toolDef.name);
  const distinctRealPaths = [...new Set(paths.map(realpath))];
  const validity = probeValidity(toolDef.checkCmd, deps.runProbe || defaultRunProbe);

  return buildRow(toolDef, {
    paths,
    distinctRealPaths,
    validity,
    latestVersion: latestFor(toolDef, deps),
  });
}

/**
 * Build the COMPLETE gate-tool set: cross-language CLI tools ∪ language tools.
 *
 * Neither half is sufficient on its own. On this machine `check-tools` listed
 * only the 8 tools of the detected languages, while `doctor` probed a different
 * 8 cross-language entries; a broken jscpd was therefore invisible to
 * `check-tools` and a broken eslint invisible to `doctor`. Completeness has to
 * mean the union.
 *
 * A tool appearing in both halves is ONE tool: its gate labels are merged rather
 * than duplicated, because "is it installed" has a single answer.
 *
 * @param {{
 *   registry: Object<string, {name: string, tools: Array}>,
 *   cliTools: Array<{tool: string, checkCmd: string, gates: string[]}>,
 *   languages: string[]|null,
 * }} options `languages: null` means every registered language.
 * @returns {Array<{name: string, checkCmd: string, optional: boolean, gates: string[], languages: string[]}>}
 */
function collectGateTools({ registry = {}, cliTools = [], languages = null } = {}) {
  const byName = new Map();
  const merge = (name, checkCmd, optional, gates, lang, install) => {
    if (!name) return;
    const existing = byName.get(name);
    if (existing) {
      for (const g of gates || []) {
        if (!existing.gates.includes(g)) existing.gates.push(g);
      }
      if (lang && !existing.languages.includes(lang)) existing.languages.push(lang);
      // A tool required by any language is not optional overall.
      existing.optional = existing.optional && Boolean(optional);
      return;
    }
    byName.set(name, {
      name,
      checkCmd,
      optional: Boolean(optional),
      gates: [...(gates || [])],
      languages: lang ? [lang] : [],
      // The installer travels with the tool: install-tools needs it, and a
      // collector that silently drops it produces "no installer known" for a
      // tool that has a perfectly good install command.
      install: install || null,
    });
  };

  const wanted = languages === null || languages === undefined ? null : languages;
  for (const [langKey, langDef] of Object.entries(registry || {})) {
    if (wanted && !wanted.includes(langKey)) continue;
    for (const t of (langDef && langDef.tools) || []) {
      // Build-file entries have no binary to probe; they are reported by the
      // language layer, not audited as executables.
      if (t.detectBy === 'build-file') continue;
      // Key by the registry key, not the display name: callers pass and compare
      // keys ('shell'), and a display name ('Shell') would silently produce an
      // empty group for a correct selection.
      merge(t.name, t.checkCmd, t.optional, t.gates, langKey, t.install);
    }
  }

  for (const c of cliTools || []) {
    merge(c.tool || c.name, c.checkCmd || `${c.tool || c.name} --version`, false, c.gates, null, c.install);
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Audit every tool in a list, producing one row per tool.
 *
 * A single unusable probe must not abort the report: a tool that cannot be
 * audited is itself a finding, and losing the other rows would hide the rest.
 *
 * @param {Array} tools from `collectGateTools`
 * @param {object} [deps] forwarded to `auditTool`, plus `resolveLatest(name)`
 */
function auditAllTools(tools = [], deps = {}) {
  const resolveLatest = deps.resolveLatest || (() => null);
  return (tools || []).map((toolDef) => {
    let latestVersion = null;
    try {
      latestVersion = resolveLatest(toolDef.name);
    } catch {
      // A registry lookup failure means "cannot determine", which the currency
      // classifier reports as unknown — never as current.
      latestVersion = null;
    }
    return auditTool(toolDef, { ...deps, latestVersion });
  });
}


/**
 * Offline latest-version table for tools that are NOT npm packages.
 *
 * These are updated by hand on purpose: fetching them needs GitHub's API or a
 * release asset download, both of which were measurably unreliable on this
 * machine (the API returned an empty body twice in a row). A stale entry here
 * produces "outdated" — the safe direction — never "current" by accident.
 * `updated` records when each value was last verified upstream so a reader can
 * judge freshness instead of trusting it blindly.
 */
const LATEST_TABLE = {
  shellcheck: { version: '0.11.0', updated: '2026-11-23' },
  hadolint: { version: '2.15.1', updated: '2026-11-23' },
  gitleaks: { version: '8.30.1', updated: '2026-11-23' },
  checkov: { version: '3.4.6', updated: '2026-11-23' },
  lizard: { version: '1.26.1', updated: '2026-11-23' },
  semgrep: { version: '1.186.0', updated: '2026-11-23' },
  jq: { version: '1.8.2', updated: '2026-11-23' },
};

/** Tools distributed through npm — looked up live, never pinned in a table. */
const NPM_TOOLS = new Set(['jscpd', 'eslint', '@archlinter/cli', 'dependency-cruiser']);

/** Which channel answers "what is the latest version" for this tool. */
function registryFor(name) {
  return NPM_TOOLS.has(name) ? 'npm' : 'table';
}

/** Default npm lookup: the official registry, because mirrors lag (measured:
 *  the npmmirror copy of the DSH plugin was 42 releases behind). */
function defaultRunNpmView(name) {
  try {
    const out = execFileSync('npm', ['view', name, 'version', '--registry=https://registry.npmjs.org'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: PROBE_TIMEOUT_MS,
      shell: process.platform === 'win32',
    });
    return String(out || '').trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the latest available version, or null when it cannot be determined.
 *
 * Returning null is a first-class outcome: the caller turns it into
 * `currency: 'unknown'`, which is reported. Coercing a failed lookup into the
 * installed version would silently declare an outdated tool current — the exact
 * "not checked equals passed" mistake this module exists to prevent.
 */
function resolveLatestVersion(name, deps = {}) {
  const runNpmView = deps.runNpmView || defaultRunNpmView;
  const table = deps.table || LATEST_TABLE;
  if (registryFor(name) === 'npm') {
    try {
      const raw = runNpmView(name);
      return raw ? parseVersion(String(raw)) : null;
    } catch {
      return null;
    }
  }
  const entry = table && table[name];
  if (!entry) return null;
  return typeof entry === 'string' ? entry : entry.version || null;
}

/**
 * Audit a list of tools with CONCURRENT async probes.
 *
 * Preferred over `auditAllTools` anywhere the result is awaited in a process
 * that also runs other probes (doctor). Wall time becomes the slowest tool
 * instead of the sum, and no probe can starve another.
 *
 * @param {Array} tools
 * @param {object} [deps] as `auditTool`, except `runProbe` may be async
 */
async function auditAllToolsAsync(tools = [], deps = {}) {
  const resolveLatest = deps.resolveLatest || (() => null);
  const runProbe = deps.runProbe || defaultRunProbeAsync;
  return Promise.all(
    (tools || []).map(async (toolDef) => {
      let latestVersion = null;
      try {
        latestVersion = resolveLatest(toolDef.name);
      } catch {
        latestVersion = null;
      }
      return auditToolAsync(toolDef, { ...deps, runProbe, latestVersion });
    }),
  );
}

/**
 * Async sibling of `auditTool`.
 *
 * Same fields, same rules — the only difference is that the probe is awaited,
 * so concurrent audits interleave instead of queueing behind each other.
 */
async function auditToolAsync(toolDef, deps = {}) {
  const locate = deps.locate || defaultLocate;
  const realpath = deps.realpath || defaultRealpath;

  const paths = locate(toolDef.name);
  const distinctRealPaths = [...new Set(paths.map(realpath))];

  let validity;
  try {
    validity = await probeValidityAsync(toolDef.checkCmd, deps.runProbe || defaultRunProbeAsync);
  } catch (err) {
    validity = interpretProbe({ status: 1 }, String(err && err.message ? err.message : err));
  }

  return buildRow(toolDef, {
    paths,
    distinctRealPaths,
    validity,
    latestVersion: latestFor(toolDef, deps),
  });
}

/** One row per distinct entity, so a duplicate is described, not just counted. */
function describeDuplicates(entry) {
  if (!entry.duplicated) return [];
  return entry.distinctRealPaths.map((real) => ({
    realPath: real,
    resolvedFrom: entry.paths.filter((p) => p === real || p.startsWith(path.dirname(real))),
  }));
}

/**
 * Summarize a list of audit entries.
 *
 * Every problem category is counted separately. Collapsing "unknown" into "ok"
 * is the same defect as reporting a skipped gate as passed, one layer up.
 */
function summarizeAudit(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  const missing = list.filter((e) => e.currency === 'missing').length;
  const duplicated = list.filter((e) => e.duplicated).length;
  const outdated = list.filter((e) => e.outdated === true).length;
  const unknown = list.filter((e) => e.currency === 'unknown').length;
  return {
    total: list.length,
    missing,
    duplicated,
    outdated,
    unknown,
    // "Complete" means every tool is present, single-copy, current AND known.
    complete: list.length > 0 && missing === 0 && duplicated === 0 && outdated === 0 && unknown === 0,
  };
}

module.exports = {
  auditTool,
  registryFor,
  resolveLatestVersion,
  LATEST_TABLE,
  NPM_TOOLS,
  auditAllTools,
  auditAllToolsAsync,
  defaultRunProbeAsync,
  collectGateTools,
  summarizeAudit,
  describeDuplicates,
  parseVersion,
  compareVersions,
  PROBE_TIMEOUT_MS,
  SYSTEM_PATH_PREFIXES,
  isSystemPath,
};
