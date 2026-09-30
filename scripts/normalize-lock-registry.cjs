#!/usr/bin/env node
/**
 * Single source of truth for the root-lockfile registry invariant: detection is
 * JSON-based (so it tolerates any formatting or line ending) and the rewrite is
 * a targeted, host-only text edit (so integrity, version and formatting survive).
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
      authority: pathStart === -1 ? resolved.slice(start) : resolved.slice(start, pathStart),
      protocol: url.protocol,
    };
  } catch {
    return { host: null, authority: null, protocol: null };
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

function findRegistryOffenders(text, approvedHosts = [CANONICAL_REGISTRY_HOST]) {
  const offenders = [];
  for (const entry of eachResolved(JSON.parse(text))) {
    const { host, authority, protocol } = urlIdentity(entry.resolved);
    if (protocol !== 'https:' && protocol !== 'http:') {
      continue;
    }
    if (host !== null && approvedHosts.includes(host)) {
      continue;
    }
    offenders.push({ ...entry, host, authority });
  }
  return offenders;
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

function normalizeLockRegistry(text) {
  const offenders = findRegistryOffenders(text);
  let output = text;
  let changed = 0;

  for (const offender of offenders) {
    if (!AUTO_FIXABLE_HOSTS.includes(offender.host)) {
      continue;
    }
    const rewritten = offender.resolved.replace(
      `//${offender.authority}`,
      `//${CANONICAL_REGISTRY_HOST}`,
    );
    const replaced = replaceResolvedValue(output, offender.resolved, rewritten);
    output = replaced.output;
    changed += replaced.count;
  }

  JSON.parse(output);

  return {
    text: output,
    changed,
    remaining: findRegistryOffenders(output).map((o) => `${o.name} -> ${o.host}`),
  };
}

function normalizeFile(lockPath) {
  const result = normalizeLockRegistry(fs.readFileSync(lockPath, 'utf8'));
  if (result.changed > 0) {
    // Atomic: a truncated lockfile is worse than a drifted one.
    const tmpPath = `${lockPath}.tmp`;
    fs.writeFileSync(tmpPath, result.text);
    fs.renameSync(tmpPath, lockPath);
  }
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const targets =
    args.length > 0 ? args : [path.resolve(__dirname, '..', 'package-lock.json')];

  let failures = 0;
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      console.error(`missing lockfile: ${target}`);
      failures += 1;
      continue;
    }
    const { changed, remaining } = normalizeFile(target);
    console.log(`${target}: ${changed} resolved host(s) rewritten`);
    if (remaining.length > 0) {
      failures += 1;
      console.error(
        `  ${remaining.length} offender(s) left, not auto-fixable (verify provenance):\n    ${remaining.slice(0, 5).join('\n    ')}`,
      );
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
  AUTO_FIXABLE_HOSTS,
};
