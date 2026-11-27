import fs from 'node:fs';
import path from 'node:path';
import { isDir, rmrf } from './util.mjs';

/**
 * Backup retention: how many copies of each agent's skill to keep.
 *
 * Split out of `util.mjs` (Gate 4: 13 exports, maximum 10). Retention is a
 * POLICY with a documented rationale; the rest of `util.mjs` is filesystem
 * primitives. Keeping them together meant every caller doing `isFile` also
 * carried the ability to delete a directory of backups.
 */

/** Read a directory, treating an unreadable one as empty. */
function dirents(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * How many backups to keep per label. Three is enough to undo the last few
 * installs and small enough that the directory cannot grow without bound.
 */
export const BACKUP_KEEP = 3;

/**
 * Delete all but the newest `keep` stamp-suffixed entries under `root`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every `install.mjs` run backs up the copy it is about to overwrite, and
 * nothing ever removed those backups. Measured on this machine before the
 * policy existed: 50 backups / 11 MB, dating back to v1.1.0, growing by one
 * set per install. Unbounded maintenance state is a slow leak the installer
 * itself creates, so the installer has to bound it.
 *
 * Only entries that parse as `<label>-YYYYMMDD-HHMMSS` are candidates: an
 * unrelated directory an operator put there is never touched, and a directory
 * this function does not recognise cannot be deleted by accident. Sorting is
 * by the timestamp IN THE NAME rather than mtime, because a restored or copied
 * directory carries an mtime that says nothing about which backup is newer.
 *
 * The cap is PER LABEL, not for the directory as a whole. One `install.mjs`
 * run backs up all nine agent copies with the same timestamp, so a single
 * global cap of 3 would delete six of the backups that run had just written --
 * the retain count would be consumed by simultaneity rather than by history,
 * and rolling back one agent would be impossible while its siblings survived.
 *
 * @returns {string[]} the directory names that were removed
 */
export function pruneBackups(root, keep = BACKUP_KEEP) {
  if (!isDir(root) || keep < 1) return [];
  const doomed = [...groupByLabel(root).values()].flatMap((names) => names.slice(keep));
  for (const name of doomed) rmrf(path.join(root, name));
  return doomed;
}

/**
 * Group stamped backup directories by agent label, each list newest first.
 *
 * Unrecognised directories are absent from the result rather than collected
 * into an "unknown" bucket: this function decides what gets deleted, so a name
 * it does not understand has to mean "leave it alone".
 * @returns {Map<string, string[]>}
 */
function groupByLabel(root) {
  const groups = new Map();
  for (const name of stampedNames(root)) {
    const label = name.slice(0, -STAMP_LEN);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(name);
  }
  for (const [label, names] of groups) groups.set(label, names.sort((a, b) => STAMP_TAIL(b).localeCompare(STAMP_TAIL(a))));
  return groups;
}

/** Names of the immediate subdirectories that carry a backup stamp. */
function stampedNames(root) {
  return dirents(root)
    .filter((d) => d.isDirectory() && STAMPED.test(d.name))
    .map((d) => d.name);
}

/** `<label>-YYYYMMDD-HHMMSS`; the label may itself contain dashes. */
const STAMPED = /-\d{8}-\d{6}$/;

/** Length of `-YYYYMMDD-HHMMSS`, i.e. the stamp plus its leading dash. */
const STAMP_LEN = 15;

/** The sortable timestamp at the end of a stamped directory name. */
function STAMP_TAIL(name) {
  return String(name).slice(-STAMP_LEN);
}
