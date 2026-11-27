/**
 * The mutation table: one entry per property the suite must actually prove.
 *
 * Kept in its own module so it can be imported without running the mutator.
 * MEASURED, and it is why this file exists: refactoring `util.mjs` into
 * `fs-tree.mjs` and moving `cmpVersion` to `version.mjs` left eight entries
 * whose anchor text no longer existed in the file they named. The mutator
 * printed "[skip] anchor not found" for each, then reported "every mutated
 * defect was caught" and exited 0 -- so a refactor could delete eight of
 * nineteen property checks and make the gate look healthier than before.
 *
 * `tests/mutation-anchors.test.mjs` now reads this table and fails when an
 * anchor is gone, which turns that silent decay into a red build.
 */

/**
 * Each mutation: file, an exact substring to replace, its replacement, and the
 * behaviour that breaking it should cost.
 */
export const MUTATIONS = [
  {
    name: 'hashTree ignores filenames',
    file: 'scripts/lib/fs-tree.mjs',
    from: "    h.update(rel);\n    h.update('\\0');",
    to: "    h.update('\\0');",
    breaks: 'a renamed file hashes the same as the original, so drift is invisible',
  },
  {
    name: 'hasXpGateMarker always true',
    file: 'scripts/lib/residue.mjs',
    from: '    return XP_GATE_MARKER.test(fs.readFileSync(abs, \'utf8\'));',
    to: '    return true;',
    breaks: 'any directory looks like ours, so unrelated user dirs get deleted',
  },
  {
    name: 'backupThenRemove skips the backup',
    file: 'scripts/lib/residue.mjs',
    from: '  else fs.cpSync(abs, dest, { recursive: true, force: true });',
    to: '  else fs.mkdirSync(dest, { recursive: true });',
    breaks: 'the original is deleted with no copy kept -- unrecoverable data loss',
  },
  {
    name: 'scanSkillResidue treats every copy as identical',
    file: 'scripts/lib/residue.mjs',
    from: '    same: hashFn(dir) === oldHashes.get(entry.name),',
    to: '    same: true,',
    breaks: "user-edited skills are queued for deletion",
  },
  {
    name: 'classifyCopy hashes skills the user wrote',
    file: 'scripts/lib/residue.mjs',
    from: '  if (!entry.isDirectory() || !oldHashes.has(entry.name)) return null;',
    to: '  if (!entry.isDirectory()) return null;\n  if (!oldHashes.has(entry.name)) return { same: false, row: {} };',
    breaks: 'a user skill absent from the old package is reported as residue of ours',
  },
  {
    name: 'pruneDeadRoots drops the hash comparison',
    file: 'scripts/lib/residue.mjs',
    from: '  return isDir(dest) && hashFn(dest) === expected;',
    to: '  return isDir(dest);',
    breaks: 'every copy is deleted, including ones the user edited',
  },
  {
    name: 'sameTree compares existence instead of content',
    file: 'scripts/lib/fs-tree.mjs',
    from: '  return hashTree(a) === hashTree(b);',
    to: '  return true;',
    breaks: 'drifted skill copies report as up to date',
  },
  {
    name: 'copyTree leaves stale files behind',
    file: 'scripts/lib/fs-tree.mjs',
    from: '  rmrf(dest);',
    to: '  ;',
    breaks: 'files removed from the package survive in every agent copy forever',
  },
  {
    name: 'cmpVersion compares the first component only',
    file: 'scripts/lib/version.mjs',
    from: '    const delta = (pa[i] || 0) - (pb[i] || 0);\n    if (delta !== 0) return Math.sign(delta);',
    to: '    const delta = (pa[i] || 0) - (pb[i] || 0);\n    if (i > 0) return 0;\n    if (delta !== 0) return Math.sign(delta);',
    breaks: '1.0.1 vs 1.0.0 compares equal, so a patch upgrade never fires',
  },
  {
    name: 'cmpVersion compares versions as strings',
    file: 'scripts/lib/version.mjs',
    from: '    const delta = (pa[i] || 0) - (pb[i] || 0);',
    to: '    const delta = pa[i] === pb[i] ? 0 : String(pa[i]).localeCompare(String(pb[i]));',
    breaks: '"1.10" ranks below "1.9", so the upgrade never fires for double-digit minors',
  },
  {
    name: 'parseLizardCsv reads NLOC as the complexity',
    file: 'scripts/lib/ccn.mjs',
    from: '    ccn: Number(cells[1]),',
    to: '    ccn: Number(cells[0]),',
    breaks: 'a 13-line flat helper outranks a genuinely branchy function',
  },
  {
    name: 'parseLizardCsv reads the token count as the complexity',
    file: 'scripts/lib/ccn.mjs',
    from: '    ccn: Number(cells[1]),',
    to: '    ccn: Number(cells[2]),',
    breaks: 'xp-gate#732 repeated: arithmetic-heavy code looks complex, branchy code passes',
  },
  {
    name: 'parseLizardCsv drops rows on a comma-bearing signature',
    file: 'scripts/lib/ccn.mjs',
    from: '  const cells = splitCsvLine(line);',
    to: "  const cells = line.split(',');",
    breaks: 'violations get detached from their file, or the row is dropped entirely',
  },
  {
    name: 'ccnViolations lets the threshold case through as a violation',
    file: 'scripts/lib/ccn.mjs',
    from: '  return rows.filter((r) => r.ccn > threshold);',
    to: '  return rows.filter((r) => r.ccn >= threshold);',
    breaks: 'every function sitting exactly on the limit is reported as debt',
  },
  {
    name: 'verdictOf reads a clean Gate 2 run as broken',
    file: 'scripts/lib/verdict.mjs',
    from: "  if (/Found 0 clones/i.test(text)) return 'passed';",
    to: '',
    breaks: 'the audit reports a failure on a clean tree and is ignored from then on',
  },
  {
    name: 'summarize ignores the invalid-control state',
    file: 'scripts/lib/gatecheck.mjs',
    from: '    pass: invalid.length === 0 && judged.every((r) => r.ok),',
    to: '    pass: judged.every((r) => r.ok),',
    breaks: 'an audit that measured nothing still reports a pass',
  },
  {
    name: 'pruneBackups caps the whole directory instead of each agent',
    file: 'scripts/lib/backups.mjs',
    from: '  const doomed = [...groupByLabel(root).values()].flatMap((names) => names.slice(keep));',
    to: '  const doomed = stampedNames(root).slice(keep);',
    breaks: 'one install run backs up all 9 agents at once, so 6 are deleted instantly and cannot be rolled back',
  },
  {
    name: 'pruneBackups keeps the oldest stamps',
    file: 'scripts/lib/backups.mjs',
    from: 'names.sort((a, b) => STAMP_TAIL(b).localeCompare(STAMP_TAIL(a)))',
    to: 'names.sort((a, b) => STAMP_TAIL(a).localeCompare(STAMP_TAIL(b)))',
    breaks: 'the most recent install is discarded and the stale copies survive',
  },
  {
    name: 'stampedNames accepts any directory',
    file: 'scripts/lib/backups.mjs',
    from: "    .filter((d) => d.isDirectory() && STAMPED.test(d.name))",
    to: "    .filter((d) => d.isDirectory())",
    breaks: "an operator's own directory under the backup root is deleted without warning",
  },
];
