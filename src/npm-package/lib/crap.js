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
 * Attach each function's file coverage and CRAP score.
 *
 * @param {Array<{file:string,name:string,ccn:number}>} functions
 * @param {Map<string, number>} coverage repo-relative path -> ratio
 * @returns {Array<object>} each with `cov` and `crap` (either may be null)
 */
function joinCoverage(functions, coverage) {
  return functions.map((fn) => {
    const key = toRepoRelative(fn.file);
    const cov = coverage instanceof Map ? coverage.get(key) : undefined;
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
 * Read per-file coverage ratios out of an istanbul coverage-final.json.
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
    if (!entry || !entry.s) continue;
    const counts = Object.values(entry.s);
    if (!counts.length) continue;
    const covered = counts.filter((c) => c > 0).length;
    const rel = path.isAbsolute(absPath)
      ? toRepoRelative(path.relative(root, absPath))
      : toRepoRelative(absPath);
    coverage.set(rel, covered / counts.length);
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
