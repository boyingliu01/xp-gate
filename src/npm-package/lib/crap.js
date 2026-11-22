'use strict';

/**
 * CRAP advisory ranking (#404 P1-2).
 *
 * CRAP(m) = comp(m)^2 * (1 - cov(m)) + comp(m)
 *
 * Uncle Bob's combined signal: complexity is only half the story, because a
 * gnarly function with dense tests is cheap to change while a simple one with
 * none is not. This module produces a RANKING for navigation. It is explicitly
 * not a gate -- see README/issue #404 for why.
 *
 * Three constraints came out of measuring the indicator on this repo before
 * writing it, each of which changes the design:
 *
 *  1. Coverage is per FILE in the artifact the gates already produce
 *     (coverage-final.json). Function-level positions could not be joined to
 *     lizard's reliably (8.4% match rate measured), so cov(m) here is the
 *     enclosing file's coverage. That over-smooths within a file; it is
 *     acceptable for ranking and not acceptable for a pass/fail verdict.
 *
 *  2. 21.8% of non-mirror source files are never loaded by any test and so have
 *     no coverage at all. Treating those as 0% would push every untested file to
 *     the top of the ranking purely for being unmeasured; treating them as 100%
 *     would hide them. They are reported separately as `unmeasured`.
 *
 *  3. src/npm-package/** is a generated mirror (canonical source is
 *     plugins/* / the repo root) and is overwritten at publish. Ranking it would
 *     direct refactoring at a file that does not survive. Excluded by default.
 */

const fs = require('fs');
const path = require('path');

/** Repository-relative paths whose canonical source lives elsewhere. */
const MIRROR_PREFIXES = ['src/npm-package/'];

function isMirrorPath(filePath) {
  if (!filePath) return false;
  const normalized = String(filePath).split('\\').join('/').replace(/^\.\//, '');
  return MIRROR_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * CRAP for one function.
 *
 * @param {number} comp cyclomatic complexity
 * @param {number|null} cov coverage ratio in [0,1], or null when unmeasured
 * @returns {number|null} null when coverage is unknown -- deliberately NOT a
 *   number, so an unmeasured function cannot be ranked at all
 */
function computeCrap(comp, cov) {
  if (cov === null || cov === undefined || Number.isNaN(cov)) return null;
  if (!Number.isFinite(comp)) return null;

  // Out-of-range coverage does occur in real istanbul output (a file counted at
  // >100% after source-map folding). Clamping keeps the score monotonic and
  // never negative, which a negative CRAP would violate by sorting below honest
  // clean functions.
  const clamped = Math.min(1, Math.max(0, cov));
  return comp * comp * (1 - clamped) + comp;
}

/** Normalise a path to the repo-relative form used by the coverage artifact. */
function toRepoRelative(filePath) {
  return String(filePath).split('\\').join('/').replace(/^\.\//, '');
}

/**
 * Make a coverage artifact's absolute path comparable to `root`.
 *
 * Node writes POSIX-style absolute paths even on Windows:
 *
 *   "/d/projects/repo/src/x.mjs"     (what coverage-summary.json holds)
 *   "D:\\projects\\repo\\src\\x.mjs"   (what process.cwd() holds)
 *
 * `path.isAbsolute` accepts the first form on win32, so the artifact path took
 * the "is absolute" branch — and `path.relative` then compared two different
 * drive spellings and produced `../../d/projects/repo/src/x.mjs`, a key that
 * matches no source file. Measured: `xp-gate crap` read the coverage map and
 * still reported every function unmeasured.
 *
 * Converting `/x/...` to `x:\...` before relativising is what makes the two forms
 * agree. On POSIX this is a no-op, because the root and the artifact are then
 * spelled the same way already.
 */
function relativiseArtifactPath(absPath, root) {
  const asPosixDrive = /^\/([A-Za-z])\//.exec(absPath);
  if (process.platform === 'win32' && asPosixDrive) {
    const drivePath = `${asPosixDrive[1].toUpperCase()}:${absPath.slice(2).split('/').join('\\')}`;
    return path.relative(root, drivePath);
  }
  return path.relative(root, absPath);
}

/**
 * Attach each function's file coverage and CRAP score.
 *
 * @param {Array<{file:string,name:string,ccn:number}>} functions
 * @param {Map<string, number>} coverage repo-relative path -> ratio
 * @returns {Array<object>} each with `cov` and `crap` (either may be null)
 */
function joinCoverage(functions, coverage) {
  const map = coverage instanceof Map ? coverage : new Map();

  // #858: build the basename index once, and record how many DISTINCT keys share
  // each basename. A count above one means the summary cannot disambiguate, and
  // guessing there would attribute one file's coverage to another -- a wrong
  // ranking, which is worse than an honest "unmeasured".
  const byBasename = new Map();
  const ambiguous = new Set();

  // The map side: two distinct coverage keys sharing one basename are ambiguous.
  for (const key of map.keys()) {
    const base = path.basename(String(key).split('\\').join('/'));
    const seen = byBasename.get(base);
    if (seen !== undefined && seen !== key) {
      ambiguous.add(base);
      continue;
    }
    byBasename.set(base, key);
  }

  // The function side matters just as much, and is the case the issue measured:
  // the summary names `util.mjs` once, but the code has src/a/util.mjs AND
  // src/b/util.mjs. Handing that one ratio to either is a coin flip, so the name
  // is ambiguous even though the summary is internally consistent.
  const namesOnFunctions = new Map();
  for (const fn of functions) {
    const base = path.basename(toRepoRelative(fn.file));
    namesOnFunctions.set(base, (namesOnFunctions.get(base) ?? 0) + 1);
  }
  for (const [base, count] of namesOnFunctions) {
    if (count > 1) ambiguous.add(base);
  }

  return functions.map((fn) => {
    const key = toRepoRelative(fn.file);

    // 1. exact normalised path
    let cov = map.get(key);

    // 2. basename fallback, only when the path did not match and the name is
    //    unambiguous. Node's own summary carries basenames only, so without this
    //    step a measured file is indistinguishable from an unmeasured one.
    if (cov === undefined) {
      const base = path.basename(key);
      if (!ambiguous.has(base) && byBasename.has(base)) {
        cov = map.get(byBasename.get(base));
      }
    }

    const known = cov === undefined ? null : cov;
    return { ...fn, file: key, cov: known, crap: computeCrap(fn.ccn, known) };
  });
}

/**
 * Build the advisory report.
 *
 * @param {Array<object>} functions joined functions (may carry null cov)
 * @param {{threshold?: number, top?: number, mirrors?: boolean}} options
 *   `mirrors: true` also ranks the generated mirror tree; default false.
 */
function buildCrapReport(functions, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 6;
  const excludeMirrors = options.mirrors !== true;

  const scored = [];
  let unmeasured = 0;

  for (const fn of functions) {
    if (excludeMirrors && isMirrorPath(fn.file)) continue;

    if (fn.cov === null || fn.cov === undefined) {
      unmeasured += 1;
      continue;
    }
    const crap = fn.crap === null || fn.crap === undefined ? computeCrap(fn.ccn, fn.cov) : fn.crap;
    if (crap === null) {
      unmeasured += 1;
      continue;
    }
    scored.push({ ...fn, crap });
  }

  scored.sort((a, b) => b.crap - a.crap || a.file.localeCompare(b.file));

  const hotspots = scored.filter((s) => s.crap >= threshold);
  const limited = Number.isFinite(options.top) && options.top >= 0 ? hotspots.slice(0, options.top) : hotspots;

  return {
    hotspots: limited,
    measured: scored.length,
    unmeasured,
    threshold,
    advisory: true,
    blocking: false,
  };
}

/**
 * Per-file coverage ratio read out of ONE Node `coverage-summary.json` entry.
 *
 * Node reports several metrics per file; the function ratio is the one CRAP
 * needs, because CRAP ranks functions. Falling back through functions -> lines ->
 * branches is deliberate: a file with no function data but real line data is
 * still partly measured, while a file with none of the three is not measured at
 * all and must stay absent (see AC-858-03 — recording it as 0 would put every
 * such file at the top of a ranking built on no evidence).
 *
 * @returns {number|null} ratio in [0,1], or null when the entry holds no metric
 */
function ratioFromNodeSummary(entry) {
  if (!entry || typeof entry !== 'object') return null;
  for (const metric of ['functions', 'lines', 'branches', 'statements']) {
    const m = entry[metric];
    if (!m || typeof m !== 'object') continue;
    // `pct` is a percentage; `total`/`covered` are the raw counts the percentage
    // was derived from. Prefer the counts (no rounding), fall back to pct.
    if (typeof m.covered === 'number' && typeof m.total === 'number' && m.total > 0) {
      return m.covered / m.total;
    }
    if (typeof m.pct === 'number' && Number.isFinite(m.pct)) {
      // Node writes 100 for "nothing to measure" as well as for full coverage.
      // A zero total is not full coverage; it is no measurement.
      if (m.total === 0) return null;
      return m.pct / 100;
    }
  }
  return null;
}

/**
 * Read per-file coverage ratios out of a coverage artifact.
 *
 * Two shapes are accepted, because two tools produce them and both are normal:
 *
 *   istanbul / vitest  coverage/coverage-final.json
 *     { "<abs path>": { s: { "<stmt id>": count } } }
 *
 *   Node built-in      coverage/coverage-summary.json
 *     { "total": {...}, "<path>": { lines: {pct}, functions: {pct}, ... } }
 *     produced by `node --test --experimental-test-coverage`
 *
 * #858: only the first was understood. A project on Node's own runner therefore
 * got "No coverage artifact" forever — its Gate 5 could accept the very same file
 * at 86.82% while CRAP called coverage absent. case 2 is the one this function
 * exists for.
 *
 * Missing or unreadable input yields an empty map, which surfaces as "every
 * function unmeasured" rather than as a silently perfect score.
 */
function readFileCoverage(coverageFile) {
  const coverage = new Map();
  let raw;
  try {
    raw = fs.readFileSync(coverageFile, 'utf8');
  } catch {
    return coverage;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return coverage;
  }

  const root = process.cwd();
  for (const [absPath, entry] of Object.entries(parsed)) {
    if (!entry || typeof entry !== 'object') continue;

    // `total` is Node's aggregate across every file, not a file. Recording it
    // would put a phantom entry in the map under a key no source path can match,
    // and worse, it reads as a real measurement (#858).
    if (absPath === 'total') continue;

    let ratio;
    if (entry.s) {
      // istanbul: statement hit counts. Unchanged behaviour (#858 AC-02).
      const counts = Object.values(entry.s);
      if (!counts.length) continue;
      const covered = counts.filter((c) => c > 0).length;
      ratio = covered / counts.length;
    } else {
      // Node summary. A file entry with no metric stays absent rather than
      // becoming a fabricated 0.
      ratio = ratioFromNodeSummary(entry);
    }
    if (ratio === null || ratio === undefined) continue;

    const rel = path.isAbsolute(absPath)
      ? toRepoRelative(relativiseArtifactPath(absPath, root))
      : toRepoRelative(absPath);
    coverage.set(rel, ratio);
  }
  return coverage;
}

/**
 * Parse lizard's CSV into functions with a repo-relative file and a CCN.
 * Column order: NLOC,CCN,token,PARAM,length,location,file,name,signature,...
 */
function parseLizardCsv(csvText) {
  const functions = [];
  for (const line of String(csvText || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g);
    if (!cells || cells.length < 8) continue;
    const clean = (i) => cells[i].replace(/,$/, '').replace(/^"|"$/g, '');

    const ccn = Number(clean(1));
    if (!Number.isFinite(ccn)) continue; // header row

    functions.push({
      file: toRepoRelative(clean(6)),
      name: clean(7),
      ccn,
    });
  }
  return functions;
}

module.exports = {
  computeCrap,
  joinCoverage,
  buildCrapReport,
  isMirrorPath,
  readFileCoverage,
  parseLizardCsv,
  MIRROR_PREFIXES,
};
