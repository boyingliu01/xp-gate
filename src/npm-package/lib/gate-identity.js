/**
 * Gate identity: the ONE place that turns `githooks/gate-registry.sh` into data.
 *
 * Why this file exists
 * --------------------
 * A gate has two properties: a NAME (`sast`, `build-integrity` — its identity,
 * stable) and a NUMBER (9, 10 — a display position, movable). Four surfaces
 * used to each declare "number -> name". Three agreed; `gate-coverage.js` alone
 * was inverted, and it carried a swap table whose comment claimed the artifact
 * producer numbers them the other way round. That claim was false — the
 * producer emits `gate9_build_integrity` and `gate10_sast`, exactly like the
 * registry. The swap table encoded an inversion that never existed, and its
 * presence made the defect read as intentional design (#738).
 *
 * Deleting that table is not a fix on its own: it removes today's copy without
 * removing the act of copying. So every consumer DERIVES from the registry, and
 * `scripts/__tests__/gate-identity-cross-surface.test.cjs` compares the
 * surfaces so a fresh copy fails a test instead of misleading a reader.
 *
 * The registry is a shell file because it must be `source`-able by
 * pre-commit/pre-push with no Node dependency. This module is the thin Node
 * reader; it does not add a build step.
 *
 * @see docs/plans/2026-11-10-gate-identity-single-source.md
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_FILENAME = 'gate-registry.sh';
const HOOKS_OF_RECORD = new Set(['pre-commit', 'pre-push']);

/**
 * Report key overrides for rows whose historical artifact key is not derivable
 * from `gate{number}_{name}`.
 *
 * Exactly one entry today. This is deliberately NOT a second table of all
 * fourteen rows: the rule derives by default, and only genuine deviations are
 * written down, so the deviation set is enumerable and reviewable.
 *
 * Read from the registry file itself (`GATE_REPORT_KEY_OVERRIDES`) so the
 * override lives beside the rows it patches — a second mapping added near the
 * comparison logic would be invisible.
 */
const DEFAULT_REPORT_KEY_OVERRIDES = new Map([['code-quality', 'gate1_static_analysis']]);

/**
 * Find every copy of the registry, deterministically.
 *
 * The policy is stated over the SET of discovered copies, never over a pair
 * (design V8/V10). A pairwise rule lets an implementation stop at the first two
 * agreeing copies and walk past a third that differs — the same drift tolerance
 * this module exists to remove. Majority voting is explicitly banned for the
 * same reason.
 *
 * Discovery is an algorithm rather than a list: a fixed list of the three known
 * paths would pass a test that injects a divergent copy at a known location
 * while missing a fourth elsewhere.
 *
 * @param {string} repoRoot
 * @returns {string[]} absolute paths, sorted for reproducible failure output
 */
function discoverRegistryCopies(repoRoot) {
  const found = [];
  const seenRealPaths = new Set();

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory is not a copy
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // `.git` is the only exclusion: mirror risk can live under
        // node_modules too, so excluding it would hide a real disagreement.
        if (entry.name === '.git') continue;
        walk(full);
        continue;
      }
      if (entry.name !== REGISTRY_FILENAME) continue;
      let realPath = full;
      try {
        realPath = fs.realpathSync(full);
      } catch {
        /* keep the literal path */
      }
      // A symlink pair resolving to the same file is ONE copy, not a
      // disagreement with itself.
      if (seenRealPaths.has(realPath)) continue;
      seenRealPaths.add(realPath);
      found.push(full);
    }
  };

  walk(repoRoot);
  return found.sort();
}

/**
 * Resolve the registry to a single, agreed-upon content.
 *
 * Implements design V8/V12: the policy applies to the copies that exist. A
 * missing path is not a failure — an `xp-gate init` consumer legitimately has
 * only `hooks/gate-registry.sh` and no root copy. Only "no copies at all"
 * fails, because then no gate identity can be determined and guessing is worse
 * than stopping at the boundary where a corrupted install should stop.
 *
 * @param {string} [repoRoot]
 * @returns {{ path: string, copies: string[], text: string }}
 */
function loadRegistry(repoRoot = path.resolve(__dirname, '..', '..', '..')) {
  const copies = discoverRegistryCopies(repoRoot);
  if (copies.length === 0) {
    throw new Error(
      `gate-identity: no ${REGISTRY_FILENAME} found under ${repoRoot}. Gate identity cannot be determined.`,
    );
  }

  const contents = copies.map((copy) => ({ path: copy, text: fs.readFileSync(copy, 'utf8') }));
  const reference = contents[0];

  for (const candidate of contents.slice(1)) {
    if (candidate.text === reference.text) continue;
    const refLines = reference.text.split('\n');
    const candLines = candidate.text.split('\n');
    const limit = Math.max(refLines.length, candLines.length);
    let firstDiff = 1;
    for (let i = 0; i < limit; i++) {
      if (refLines[i] !== candLines[i]) {
        firstDiff = i + 1;
        break;
      }
    }
    throw new Error(
      'gate-identity: registry copies disagree. A copy disagreement IS the defect '
      + `this module exists to remove, so it is a hard failure rather than a silent pick.\n`
      + `  copies (sorted):\n${copies.map((copy) => `    ${copy}`).join('\n')}\n`
      + `  first difference: ${reference.path} vs ${candidate.path}, line ${firstDiff}\n`
      + `    ${JSON.stringify(refLines[firstDiff - 1] ?? '')} != ${JSON.stringify(candLines[firstDiff - 1] ?? '')}`,
    );
  }

  return { path: reference.path, copies, text: reference.text };
}

/**
 * Parse `GATE_REGISTRY_ROWS=( ... )` into row objects.
 *
 * Scoped to the array block: a "line starts with a quote" parser also matches
 * the quoted usage examples in the header comment, inventing rows that do not
 * exist. Lines outside the block must be blank or comments; anything else
 * throws, because a parser that silently skips is how a row vanishes from every
 * surface at once.
 *
 * @param {string} text
 * @returns {Array<{name: string, number: string, impl: string, blocks: string, hook: string}>}
 */
function parseRegistry(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^GATE_REGISTRY_ROWS=\($/.test(line.trim()));
  if (start === -1) throw new Error('gate-identity: GATE_REGISTRY_ROWS array not found');

  const rows = [];
  let closed = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === ')') {
      closed = true;
      break;
    }
    if (line === '' || line.startsWith('#')) continue;
    const match = line.match(/^"([^"]*)"$/);
    if (!match) throw new Error(`gate-identity: unparseable registry row at line ${i + 1}: ${line}`);
    const fields = match[1].split('|');
    // 4 fields = legacy row written before the `hook` column existed; it is a
    // pre-commit row by construction.
    if (fields.length !== 4 && fields.length !== 5) {
      throw new Error(`gate-identity: registry row must have 4 or 5 fields, got ${fields.length}: ${line}`);
    }
    const [name, number, impl, blocks, hook = 'pre-commit'] = fields;
    if (blocks !== 'YES' && blocks !== 'NO') {
      throw new Error(`gate-identity: blocks must be YES or NO, got "${blocks}": ${line}`);
    }
    if (!HOOKS_OF_RECORD.has(hook)) {
      throw new Error(`gate-identity: hook must be one of ${[...HOOKS_OF_RECORD].join('|')}, got "${hook}": ${line}`);
    }
    rows.push({ name, number, impl, blocks, hook });
  }
  if (!closed) throw new Error('gate-identity: GATE_REGISTRY_ROWS array was not closed with ")"');

  const numbers = rows.map((row) => row.number);
  if (new Set(numbers).size !== numbers.length) throw new Error('gate-identity: duplicate gate numbers in registry');
  const names = rows.map((row) => row.name);
  if (new Set(names).size !== names.length) throw new Error('gate-identity: duplicate gate names in registry');

  return rows;
}

/**
 * Parse `GATE_REPORT_KEY_OVERRIDES` if the registry declares it.
 * Absent means "the default derivation covers everything", which today is
 * almost true: exactly one row deviates.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseReportKeyOverrides(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^GATE_REPORT_KEY_OVERRIDES=\($/.test(line.trim()));
  if (start === -1) return new Map(DEFAULT_REPORT_KEY_OVERRIDES);

  const overrides = new Map();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === ')') break;
    if (line === '' || line.startsWith('#')) continue;
    const match = line.match(/^"([^"|]+)\|([^"|]+)"$/);
    if (!match) throw new Error(`gate-identity: unparseable GATE_REPORT_KEY_OVERRIDES row: ${line}`);
    overrides.set(match[1], match[2]);
  }
  return overrides;
}

/**
 * The artifact report key for a row.
 *
 * Override is applied HERE, at emission time, and never inside a comparison:
 * an override that voted on equality would mask a real registry/artifact
 * mismatch — the original inversion wearing a different hat (design V11).
 *
 * @param {{name: string, number: string}} row
 * @param {Map<string, string>} [overrides]
 * @returns {string}
 */
function reportKey(row, overrides = DEFAULT_REPORT_KEY_OVERRIDES) {
  const override = overrides.get(row.name);
  if (override) return override;
  return `gate${row.number}_${row.name.replace(/-/g, '_')}`;
}

/**
 * Build gate-coverage's table from registry rows — replacing the literal array
 * that carried the inversion.
 *
 * @param {Array<object>} rows
 * @param {Map<string, string>} [overrides]
 */
function deriveGateTable(rows, overrides = DEFAULT_REPORT_KEY_OVERRIDES) {
  return rows.map((row) => ({
    // `gate` is numeric for pre-commit gates (0..13) — existing consumers
    // compare it with numbers (`r.gate === 0`, `row.gate === BOY_SCOUT_GATE`).
    // Pre-push numbers are strings (M, M2, ML, UI, MW, S) and stay strings:
    // NaN is not a number anyone can reason about, and `parseInt('M2')` would
    // silently become NaN and match nothing.
    gate: /^\d+$/.test(row.number) ? Number(row.number) : row.number,
    number: row.number,
    name: row.name,
    slug: row.name,
    impl: row.impl,
    blocks: row.blocks === 'YES',
    hook: row.hook,
    reportKey: reportKey(row, overrides),
  }));
}

/**
 * Compare surfaces against the registry. PURE — the caller injects them.
 *
 * Injection is what makes AC-GATEID-002-04 checkable: a test feeds a row array
 * where gate 9's name has been flipped to `sast` and asserts a violation comes
 * back. Mutating the real registry file inside a test would pollute the worktree
 * and could not run under parallel CI.
 *
 * Comparison is on the registry SLUG and NUMBER. Report keys are deliberately
 * not compared, because that is where the one legitimate historical override
 * lives and an override must never excuse a mismatch.
 *
 * @param {Array<object>} registryRows
 * @param {Object<string, Map<string, string>>} surfaces  hook/name -> (number -> name)
 * @returns {Array<{number: string, surface: string, expected: string, actual: string}>}
 */
function checkCrossSurface(registryRows, surfaces = {}) {
  const violations = [];
  for (const [surfaceName, byNumber] of Object.entries(surfaces)) {
    if (!byNumber || typeof byNumber.get !== 'function') continue;
    for (const row of registryRows) {
      const actual = byNumber.get(row.number);
      if (actual === undefined) {
        violations.push({ number: row.number, surface: surfaceName, expected: row.name, actual: '<missing>' });
        continue;
      }
      if (actual !== row.name) {
        violations.push({ number: row.number, surface: surfaceName, expected: row.name, actual });
      }
    }
  }
  return violations;
}

module.exports = {
  REGISTRY_FILENAME,
  HOOKS_OF_RECORD,
  DEFAULT_REPORT_KEY_OVERRIDES,
  discoverRegistryCopies,
  loadRegistry,
  parseRegistry,
  parseReportKeyOverrides,
  reportKey,
  deriveGateTable,
  checkCrossSurface,
};
