/**
 * Mirror manifest: which canonical sources must be byte-identical in the npm package
 * (#654).
 *
 * `githooks/**` and `plugins/*​/src/**` are canonical; `src/npm-package/**` holds
 * byte-identical mirrors that get published. Editing a mirror only means the next
 * prepack silently regenerates it — v0.27.3 shipped exactly that bug.
 *
 * `AGENTS.md` states the rule clearly and it still gets violated ~58 times, because
 * the constraint is *structural* (which file is source, which is mirror, who depends
 * on whom), not stylistic. Knowing the rule does not remove the need to track the
 * mapping across a multi-file edit; that is tooling's job.
 *
 * Hence this module: the mapping is data, and a canonical file missing from the
 * mapping is an error rather than a silent no-op.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Directories (repo-relative) whose files mirror into the package. */
const MIRRORED_ROOTS = [
  { from: 'githooks', to: 'src/npm-package/hooks' },
];

/** Individual canonical files that mirror into a different location. */
const INDIVIDUAL_PAIRS = [
  { source: 'githooks/pre-commit', mirror: 'src/npm-package/hooks/pre-commit' },
  { source: 'githooks/pre-push', mirror: 'src/npm-package/hooks/pre-push' },
];

/** Paths inside a mirrored root that are NOT mirrored (tests, docs). */
const EXCLUDED_PREFIXES = ['__tests__/', 'node_modules/', '.git/'];

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Recursively list files under `dir`, repo-relative and forward-slashed. */
function listFiles(root, dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const rel = toPosix(path.join(dir, entry.name));
    if (entry.isDirectory()) {
      if (EXCLUDED_PREFIXES.some((p) => `${entry.name}/` === p)) continue;
      listFiles(root, rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Expand the declared mapping into concrete source→mirror pairs.
 *
 * @param {{cwd?: string}} opts
 * @returns {Array<{source: string, mirror: string}>}
 */
function declareSources(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const pairs = [...INDIVIDUAL_PAIRS];
  const seen = new Set(pairs.map((p) => p.source));
  for (const root of MIRRORED_ROOTS) {
    for (const file of listFiles(cwd, root.from)) {
      if (seen.has(file)) continue;
      const rest = file.slice(root.from.length + 1);
      if (EXCLUDED_PREFIXES.some((prefix) => rest.startsWith(prefix))) continue;
      pairs.push({ source: file, mirror: `${root.to}/${rest}` });
      seen.add(file);
    }
  }
  return pairs.sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * Canonical files that exist but appear in no mapping entry.
 *
 * This is the check that turns "someone forgot to register java.sh" from a
 * publish-time rollback into a red test at commit time. Silence here is the failure
 * mode worth preventing: a file that is never mirrored looks fine locally and
 * disappears from the published package.
 *
 * @param {{cwd?: string, files?: string[], declared?: Array<{source: string}>}} opts
 * @returns {string[]}
 */
function findUnlistedSources(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const declared = opts.declared || declareSources({ cwd });
  const declaredSet = new Set(declared.map((entry) => entry.source));
  const present = opts.files || listFiles(cwd, 'githooks');
  return present
    .filter((file) => !EXCLUDED_PREFIXES.some((prefix) => file.slice('githooks/'.length).startsWith(prefix)))
    .filter((file) => !declaredSet.has(file))
    .sort();
}

/** Human-readable drift report; empty array means clean. */
function describeUnlisted(unlisted) {
  return unlisted.map(
    (file) => `${file} is a canonical source with no mirror entry — the published package will not carry it`,
  );
}

module.exports = { declareSources, findUnlistedSources, describeUnlisted, MIRRORED_ROOTS };
