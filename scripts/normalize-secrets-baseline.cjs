#!/usr/bin/env node
/**
 * Normalize the path separators in a detect-secrets baseline (issue #735).
 *
 * WHY THIS EXISTS
 * ---------------
 * On Windows, `detect-secrets scan --baseline .secrets.baseline` writes
 * backslash paths (`src\\a.ts`) where a Linux run writes forward slashes
 * (`src/a.ts`). The baseline is committed, so the two forms fight each other:
 * a Windows scan rewrites ~322 lines, a Linux scan rewrites them back, and the
 * diff is pure formatting. That permanently poisons the one signal the baseline
 * carries — "did a NEW secret appear?" — because a real new entry is now
 * indistinguishable from separator churn without reading every line.
 *
 * The fix is to canonicalize on forward slashes, which is what every
 * detect-secrets release on every platform already produces for paths that did
 * not come from a Windows walk. This is not a re-interpretation of the data:
 * `src\\a.ts` and `src/a.ts` name the same file, and treating them as two
 * entries is the bug.
 *
 * WHAT IT TOUCHES
 * ---------------
 * ONLY top-level `results` keys and each entry's `filename` field. Nothing else
 * is read, reordered, re-indented or recomputed — notably `hashed_secret`,
 * `line_number`, `type` and the `is_*` flags are carried through untouched, so
 * an entry that allowed a specific secret on a specific line keeps meaning
 * exactly that.
 *
 * USAGE
 *   node scripts/normalize-secrets-baseline.cjs [path]   # default .secrets.baseline
 *   node scripts/normalize-secrets-baseline.cjs --check  # exit 1 if it WOULD change
 *
 * `--check` is the idempotency gate: running the normalizer twice must leave the
 * second diff empty, and that property is asserted by a test rather than assumed.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = '.secrets.baseline';

/** True when `p` contains a Windows path separator. */
function hasBackslash(p) {
  return typeof p === 'string' && p.includes('\\');
}

/**
 * Normalize one path string. Backslashes become forward slashes and repeated
 * separators collapse, so `.\src\\a.ts` and `src/a.ts` compare equal. A leading
 * `./` is dropped for the same reason detect-secrets itself does not emit one.
 */
function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '');
}

/**
 * A stable identity for one baseline entry, safe on a non-object entry.
 *
 * `null`/`undefined`/primitives can appear in a hand-edited or partially
 * written baseline. They cannot be deduplicated meaningfully, so each gets a
 * unique identity and survives the merge — losing an entry is always worse than
 * keeping a malformed one, which the human review of the diff will catch.
 */
function entryId(entry) {
  if (!entry || typeof entry !== 'object') return `\u0001${String(entry)}`;
  return `${entry.type}\u0000${entry.hashed_secret}\u0000${entry.line_number}`;
}

/**
 * Rewrite a parsed baseline in place, returning the number of fields changed.
 * Exported for the idempotency test.
 */
function normalizeBaseline(parsed) {
  let changed = 0;
  if (!parsed || typeof parsed !== 'object' || !parsed.results || typeof parsed.results !== 'object') {
    return changed;
  }

  const rebuilt = {};
  for (const [rawKey, entries] of Object.entries(parsed.results)) {
    const key = normalizePath(rawKey);
    if (key !== rawKey) changed++;
    const list = Array.isArray(entries) ? entries : [];
    for (const entry of list) {
      if (entry && typeof entry === 'object' && hasBackslash(entry.filename)) {
        entry.filename = normalizePath(entry.filename);
        changed++;
      }
    }
    // Two keys can collide after normalization (a file recorded once with each
    // separator). Merge rather than overwrite: dropping entries would silently
    // un-allowlist a finding, which is the exact failure this whole issue is
    // about. Deduplicate on the fields that identify an entry.
    //
    // The identity is built through `entryId`, which tolerates a non-object
    // entry. The old code dereferenced `entry.type` directly, so a baseline
    // holding a `null` in a colliding array threw a TypeError — and the gate's
    // `|| true` swallowed it, leaving the file un-normalized while the
    // comparison ran on mixed separators. Measured before the guard:
    // `normalizeBaseline({results:{'a\\b.ts':[null],'a/b.ts':[...]}})` threw.
    if (Object.prototype.hasOwnProperty.call(rebuilt, key)) {
      const seen = new Set(rebuilt[key].map(entryId));
      for (const entry of list) {
        const id = entryId(entry);
        if (!seen.has(id)) {
          seen.add(id);
          rebuilt[key].push(entry);
        }
      }
    } else {
      rebuilt[key] = list;
    }
  }
  parsed.results = rebuilt;
  return changed;
}

/**
 * Serialize with detect-secrets' own formatting: 2-space indent, trailing
 * newline, and — critically — THE SAME LINE ENDING the file already had.
 *
 * Emitting LF into a CRLF baseline rewrites every line. That is the exact
 * failure #735 is about (a pure-formatting diff that hides real findings), just
 * with a different trigger, and it was caught by measuring rather than trusting:
 * a 63307-byte CRLF baseline came back 61411 bytes, all 1896 lines changed, while
 * the parsed content compared equal. Preserving the original ending is what makes
 * a second run a true no-op on Windows as well as on Linux.
 */
function serialize(parsed, eol = '\n') {
  return JSON.stringify(parsed, null, 2).replace(/\n/g, eol) + eol;
}

/** The line ending a file already uses; LF for a file without any. */
function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function main(argv) {
  const checkOnly = argv.includes('--check');
  const target = argv.find((a) => !a.startsWith('--')) || DEFAULT_PATH;

  if (!fs.existsSync(target)) {
    console.error(`FAIL — baseline not found: ${path.resolve(target)}`);
    // Exit 2 ("no evidence"), never 0: a missing baseline must not read as
    // "already normalized" (same discipline as ccn-report's missing root, #737).
    process.exit(2);
  }

  const original = fs.readFileSync(target, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(original);
  } catch (err) {
    console.error(`FAIL — baseline is not valid JSON: ${err.message}`);
    process.exit(2);
  }

  const changed = normalizeBaseline(parsed);
  const next = serialize(parsed, detectEol(original));

  if (next === original) {
    console.log(`OK — ${target} is already normalized (0 fields changed).`);
    return;
  }

  if (checkOnly) {
    console.error(`FAIL — ${target} has ${changed} non-normalized path field(s).`);
    console.error('Run: node scripts/normalize-secrets-baseline.cjs ' + target);
    process.exit(1);
  }

  fs.writeFileSync(target, next);
  console.log(`NORMALIZED — ${target}: ${changed} path field(s) rewritten to forward slashes.`);
  console.log('Review before committing: this must contain no new secrets.');
}

module.exports = { normalizeBaseline, normalizePath, serialize };

if (require.main === module) {
  main(process.argv.slice(2));
}
