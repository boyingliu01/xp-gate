#!/usr/bin/env node
/**
 * Single source of truth for the root-lockfile registry invariant: detection is
 * JSON-based (so it tolerates any formatting or line ending) and the rewrite is
 * a targeted, source-only text edit (so integrity, version and formatting survive).
 *
 * Why not `.npmrc` replace-registry-host: measured on npm 11.17.0 against
 * registry.npmmirror.com the option is a no-op for every value tried, see
 * docs/plans/2026-09-30-package-lock-registry-normalization.md.
 */

const fs = require('node:fs');
const path = require('node:path');

const CANONICAL_REGISTRY_HOST = 'registry.npmjs.org';
// Path layout matches the canonical registry, so a host swap is valid.
const AUTO_FIXABLE_HOSTS = ['registry.npmmirror.com'];

function urlIdentity(resolved) {
  try {
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
      parseError: null,
    };
  } catch {
    return {
      host: null,
      hostWithPort: null,
      authority: null,
      protocol: null,
      hasCredentials: false,
      parseError: 'unparseable',
    };
  }
}

function eachResolved(lock) {
  const entries = [];
  for (const [name, meta] of Object.entries(lock.packages || {})) {
    if (meta && meta.resolved) {
      entries.push({ name, resolved: meta.resolved });
    }
  }
  // lockfileVersion 1/2 keep a legacy tree with the same field.
  const walk = (deps, prefix) => {
    for (const [name, meta] of Object.entries(deps || {})) {
      const full = prefix ? `${prefix}/${name}` : name;
      if (!meta || typeof meta !== 'object') {
        continue;
      }
      if (meta.resolved) {
        entries.push({ name: full, resolved: meta.resolved });
      }
      if (meta.dependencies) {
        walk(meta.dependencies, full);
      }
    }
  };
  walk(lock.dependencies, '');
  return entries;
}

// The invariant is narrower than "the hostname looks right": a resolved entry
// counts as clean only over https, on the bare canonical host, with no
// credentials and no port.
function isClean(identity) {
  return (
    identity.protocol === 'https:' &&
    !identity.hasCredentials &&
    identity.hostWithPort === CANONICAL_REGISTRY_HOST
  );
}

function collectOffenders(lock) {
  const offenders = [];
  for (const entry of eachResolved(lock)) {
    const identity = urlIdentity(entry.resolved);
    // git+ssh://, git://, file: etc. are not registry downloads.
    const isRegistryScheme = identity.protocol === 'https:' || identity.protocol === 'http:';
    if (identity.protocol !== null && !isRegistryScheme) {
      continue;
    }
    if (identity.parseError !== null) {
      offenders.push({ ...entry, host: identity.parseError, authority: null });
      continue;
    }
    if (isClean(identity)) {
      continue;
    }
    offenders.push({ ...entry, host: identity.host, authority: identity.authority });
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
  const tail = offender.resolved.slice(
    offender.resolved.indexOf('//') + 2 + offender.authority.length,
  );
  return `https://${CANONICAL_REGISTRY_HOST}${tail}`;
}

function fixableOffender(offender) {
  // A canonical hostname on a non-default port is not a mirror leak — silently
  // re-routing it would hide whatever interception the port implies.
  if (offender.host === CANONICAL_REGISTRY_HOST) {
    return offender.authority === CANONICAL_REGISTRY_HOST;
  }
  return AUTO_FIXABLE_HOSTS.includes(offender.host);
}

// Every differing leaf path must be a "resolved" value: this is what makes the
// "host-and-source-only rewrite" claim checkable instead of structural luck.
function assertOnlyResolvedChanged(before, after) {
  const deltas = [];
  const walk = (a, b, trail) => {
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
      if (a !== b) {
        deltas.push(trail);
      }
      return;
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      walk(a[key], b[key], [...trail, key]);
    }
  };
  walk(before, after, []);
  const unexpected = deltas.filter((trail) => trail[trail.length - 1] !== 'resolved');
  if (unexpected.length > 0) {
    throw new Error(
      `rewrite touched non-resolved fields: ${unexpected.slice(0, 3).map((t) => t.join('.'))}`,
    );
  }
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
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      console.error(`not a lockfile: ${target}`);
      failures += 1;
      continue;
    }
    const { changed, remaining } = normalizeFile(target);
    console.log(`${target}: ${changed} resolved source(s) rewritten`);
    if (remaining.length > 0) {
      failures += 1;
      console.error(
        `  ${remaining.length} offender(s) left, not auto-fixable (rewrite by hand only\n` +
          '  after verifying each tarball against registry.npmjs.org metadata):',
      );
      console.error(`    ${remaining.slice(0, 5).join('\n    ')}`);
    }
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
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
