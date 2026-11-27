#!/usr/bin/env node
/**
 * Single source of truth for the root-lockfile registry invariant: detection is
 * JSON-based (so it tolerates any formatting or line ending) and the rewrite is
 * a targeted, source-only text edit (so integrity, version and formatting survive).
 *
 * Why not `.npmrc` replace-registry-host: measured on npm 11.17.0 against
 * registry.npmmirror.com, no value of that option changes the mirror host npm
 * *writes* into `resolved` (at download time it does rewrite hosts, which is why
 * this tool only guards the artifact). See
 * docs/plans/2026-09-30-package-lock-registry-normalization.md (M3/M4, M8).
 */

const fs = require('node:fs');
const path = require('node:path');

const CANONICAL_REGISTRY_HOST = 'registry.npmjs.org';
// Path layout matches the canonical registry, so a host swap is valid.
const AUTO_FIXABLE_HOSTS = ['registry.npmmirror.com'];

/**
 * The identity of a URL that could not be parsed at all.
 *
 * Every field is null/false so comparing two unusable values yields "same shape, no
 * information" rather than a partial match on one field.
 */
function unparsableIdentity(parseError) {
  return {
    host: null,
    hostWithPort: null,
    authority: null,
    protocol: null,
    hasCredentials: false,
    hasQueryOrFragment: false,
    tail: null,
    textTail: null,
    parseError,
  };
}

/**
 * The identity fields of a URL that parsed.
 *
 * Two independent readings of the same TAIL are kept: the parsed one is what npm would
 * fetch, and the text slice is what a host swap can re-attach verbatim -- a lockfile
 * differing only in quoting must not look like a registry change.
 */
function identityOfParsedUrl(resolved) {
  const url = new URL(resolved);
  const start = resolved.indexOf('//') + 2;
  const pathStart = resolved.indexOf('/', start);
  // hostname (not host) keeps credentials out of any reported value.
  return {
    host: url.hostname,
    hostWithPort: url.host,
    authority: pathStart === -1 ? resolved.slice(start) : resolved.slice(start, pathStart),
    protocol: url.protocol,
    hasCredentials: Boolean(url.username || url.password),
    hasQueryOrFragment: Boolean(url.search || url.hash),
    tail: `${url.pathname}${url.search}${url.hash}`,
    textTail: pathStart === -1 ? '' : resolved.slice(pathStart),
    parseError: null,
  };
}

function urlIdentity(resolved) {
  if (typeof resolved !== 'string') return unparsableIdentity('not-a-string');
  try {
    return identityOfParsedUrl(resolved);
  } catch {
    return unparsableIdentity('unparseable');
  }
}

/**
 * Whether a metadata value is PRESENT.
 *
 * A present-but-non-string `resolved` is corruption, not absence: it is collected so
 * the classifier reports it, instead of the entry being certified clean.
 */
function isPresent(meta) {
  return meta !== undefined && meta !== null;
}

/**
 * Every `resolved` entry in a lockfile, flattened to `name` + `resolved`.
 *
 * Both lockfile shapes carry the field, so the "worth reporting" rule is stated once
 * here rather than twice with different names.
 */
function eachResolved(lock) {
  const entries = [];
  collectResolved(entries, lock.packages || {}, '');
  collectResolved(entries, lock.dependencies, '');
  return entries;
}

/**
 * Walk one dependency tree, pushing every present `resolved`.
 *
 * The tree is keyed by NAME at each level, so the reporting name is the PATH to the
 * entry (`a/b/c`). Without the prefix, two packages sharing a name at different depths
 * would collapse into one report line and the reader could not tell which carries a
 * bad URL.
 *
 * @param {Array} entries mutated
 * @param {object|undefined} deps the tree at this level
 * @param {string} prefix path so far, '' at the root
 */
function collectResolved(entries, deps, prefix) {
  for (const [name, meta] of Object.entries(deps || {})) {
    if (!meta || typeof meta !== 'object') continue;
    const full = prefix ? `${prefix}/${name}` : name;
    if (isPresent(meta.resolved)) entries.push({ name: full, resolved: meta.resolved });
    collectResolved(entries, meta.dependencies, full);
  }
}

// The invariant is narrower than "the hostname looks right": a resolved entry
// counts as clean only over https, on the bare canonical host, with no
// credentials, no port and no query — a token can hide in either.
function isClean(identity) {
  return (
    identity.protocol === 'https:' &&
    !identity.hasCredentials &&
    !identity.hasQueryOrFragment &&
    identity.hostWithPort === CANONICAL_REGISTRY_HOST
  );
}


/** The schemes that are REGISTRY downloads; everything else is not one. */
const REGISTRY_SCHEMES = new Set(['https:', 'http:']);

/**
 * The offender record for one entry, or null when it is not one.
 *
 * Three outcomes, in this order:
 *
 *  - a non-registry scheme (`git+ssh:`, `file:`) is not a download at all, so it is
 *    neither clean nor an offender -- the tool must not rewrite a git URL;
 *  - an unparseable URL is an offender whose `host` carries the PARSE ERROR, because
 *    the reader needs to know why rather than see a blank host;
 *  - anything else is an offender only when it fails the cleanliness check.
 */
function classifyEntry(entry) {
  const identity = urlIdentity(entry.resolved);
  if (identity.protocol !== null && !REGISTRY_SCHEMES.has(identity.protocol)) return null;
  if (identity.parseError !== null) {
    return { ...entry, host: identity.parseError, authority: null };
  }
  if (isClean(identity)) return null;
  return {
    ...entry,
    host: identity.host,
    authority: identity.authority,
    tail: identity.tail,
    textTail: identity.textTail,
  };
}

function collectOffenders(lock) {
  const offenders = [];
  for (const entry of eachResolved(lock)) {
    const offender = classifyEntry(entry);
    if (offender) offenders.push(offender);
  }
  return offenders;
}

function findRegistryOffenders(text) {
  return collectOffenders(JSON.parse(text));
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function replaceResolvedValue(text, from, to) {
  let count = 0;
  const pattern = new RegExp(`("resolved"\\s*:\\s*)"${escapeForRegExp(from)}"`, 'g');
  // Same tarball URL can back several node_modules paths; count every rewrite.
  const output = text.replace(pattern, (match, prefix) => {
    count += 1;
    return `${prefix}"${to}"`;
  });
  return { output, count };
}

function canonicalTarget(offender) {
  return `https://${CANONICAL_REGISTRY_HOST}${offender.textTail}`;
}

function fixableOffender(offender) {
  // The rewrite re-attaches the text tail under a new authority. When the two
  // readings of the tail disagree, part of the URL lives inside the authority
  // being discarded, so refuse to guess and let the caller see it.
  if (offender.tail !== offender.textTail) {
    return false;
  }
  // A canonical hostname on a non-default port is not a mirror leak — silently
  // re-routing it would hide whatever interception the port implies.
  if (offender.host === CANONICAL_REGISTRY_HOST) {
    if (offender.authority !== CANONICAL_REGISTRY_HOST) {
      return false;
    }
  } else if (!AUTO_FIXABLE_HOSTS.includes(offender.host)) {
    return false;
  }
  // A rewrite that lands back on the input is not a fix; report it instead of
  // counting a no-op as repaired.
  return canonicalTarget(offender) !== offender.resolved;
}

// Every differing leaf path must be a "resolved" value: this is what makes the
// "host-and-source-only rewrite" claim checkable instead of structural luck.
/**
 * Collect the paths at which two JSON documents differ.
 *
 * Compared LEAF by leaf rather than as text: a textual diff cannot say WHICH field
 * changed, and the whole claim being checked is "only `resolved` values moved".
 *
 * @param {unknown} a
 * @param {unknown} b
 * @param {string[]} trail keys from the root to this node
 * @param {string[][]} out accumulated differing paths
 */

/** Whether both values are non-null objects, so their keys can be compared. */
function isBothObjects(a, b) {
  return typeof a === 'object' && a !== null && typeof b === 'object' && b !== null;
}

function collectDeltaPaths(a, b, trail, out) {
  if (!isBothObjects(a, b)) {
    if (a !== b) out.push(trail);
    return;
  }
  // The UNION of keys: a key present on only one side is a change too.
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    collectDeltaPaths(a[key], b[key], [...trail, key], out);
  }
}

/**
 * Throw unless the rewrite touched ONLY `resolved` values.
 *
 * This is what makes the "host-and-source-only rewrite" claim checkable instead of
 * structural luck: every differing leaf path must end in `resolved`.
 */
function assertOnlyResolvedChanged(before, after) {
  const deltas = [];
  collectDeltaPaths(before, after, [], deltas);
  const unexpected = deltas.filter((trail) => trail[trail.length - 1] !== 'resolved');
  if (unexpected.length === 0) return;
  throw new Error(
    `rewrite touched non-resolved fields: ${unexpected.slice(0, 3).map((t) => t.join('.'))}`,
  );
}

function normalizeLockRegistry(text) {
  const before = JSON.parse(text);
  let output = text;
  let changed = 0;

  // One tarball URL can back many node_modules paths; rewrite each value once.
  const seen = new Set();
  for (const offender of collectOffenders(before)) {
    if (!fixableOffender(offender) || offender.authority === null || seen.has(offender.resolved)) {
      continue;
    }
    seen.add(offender.resolved);
    const replaced = replaceResolvedValue(output, offender.resolved, canonicalTarget(offender));
    output = replaced.output;
    changed += replaced.count;
  }

  const after = JSON.parse(output);
  assertOnlyResolvedChanged(before, after);

  return {
    text: output,
    changed,
    remaining: collectOffenders(after).map((o) => `${o.name} -> ${o.host}`),
  };
}

function normalizeFile(lockPath) {
  const result = normalizeLockRegistry(fs.readFileSync(lockPath, 'utf8'));
  if (result.changed > 0) {
    // Atomic: a truncated lockfile is worse than a drifted one.
    const tmpPath = `${lockPath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpPath, result.text);
      fs.renameSync(tmpPath, lockPath);
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
  }
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const targets =
    args.length > 0 ? args : [path.resolve(__dirname, '..', 'package-lock.json')];

  let failures = 0;
  for (const target of targets) {
    if (!processTarget(target)) failures += 1;
  }
  if (failures > 0) process.exitCode = 1;
}

/**
 * Normalise one lockfile, reporting what it did.
 *
 * Returns whether this target counted as a FAILURE. One bad target must not abort the
 * remaining arguments, and a stack trace is not an actionable message at a terminal --
 * so every failure path prints a sentence and moves on.
 */
function processTarget(target) {
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    console.error(`not a lockfile: ${target}`);
    return false;
  }
  let changed;
  let remaining;
  try {
    ({ changed, remaining } = normalizeFile(target));
  } catch (error) {
    console.error(`${target}: not processed — ${error.message}`);
    return false;
  }
  console.log(`${target}: ${changed} resolved source(s) rewritten`);
  if (remaining.length === 0) return true;
  reportRemaining(remaining);
  return false;
}

/**
 * Report offenders the tool could NOT fix.
 *
 * Prints at most five: the list is for "what is left", and a wall of paths buries the
 * instruction that most of them need a hand rewrite verified against the real registry.
 */
function reportRemaining(remaining) {
  console.error(
    `  ${remaining.length} offender(s) left, not auto-fixable:\n` +
      '  rewrite by hand only after verifying each tarball against registry.npmjs.org metadata',
  );
  console.error(`    ${remaining.slice(0, 5).join('\n    ')}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizeLockRegistry,
  normalizeFile,
  findRegistryOffenders,
  CANONICAL_REGISTRY_HOST,
};
