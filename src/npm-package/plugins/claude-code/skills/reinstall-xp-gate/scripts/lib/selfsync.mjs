import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './proc.mjs';
import { copyTree, isDir, isFile, pruneBackups, sameTree, stamp } from './util.mjs';
import { cmpVersion } from './version.mjs';

const SKILL_NAME = 'reinstall-xp-gate';

/**
 * The tree `install.mjs` copies from.
 *
 * MEASURED on the 2.0.1 release: this returned the canonical copy whenever it
 * existed, so a checkout at 2.0.1 kept distributing the 2.0.0 it had installed
 * earlier and reported "已写入 0 个副本". The newer tree has to win, or a
 * release never reaches the machines it was built on.
 */
export function defaultSource(selfDir) {
  const canonical = path.join(HOME, '.local', 'share', 'xp-gate', 'skills', SKILL_NAME);
  return newerSkillDir(selfDir, canonical);
}

/** The skill tree with the higher VERSION, ignoring a dir that is not one. */
export function newerSkillDir(a, b) {
  const av = skillVersion(a);
  const bv = skillVersion(b);
  if (av === null) return bv === null ? a : b;
  if (bv === null) return a;
  return cmpVersion(av, bv) < 0 ? b : a;
}

/** The VERSION of a skill tree, or null when the dir is not one. */
function skillVersion(dir) {
  if (!isDir(dir) || !isFile(path.join(dir, 'SKILL.md'))) return null;
  const versionFile = path.join(dir, 'VERSION');
  if (!isFile(versionFile)) return '';
  return fs.readFileSync(versionFile, 'utf8').trim();
}

export function backupDirFor(agent) {
  const label = String(agent).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'agent';
  return path.join(HOME, '.local', 'share', 'xp-gate', 'skills', '.backups', `${label}-${stamp()}`);
}

/** What would have to happen to bring one agent root up to date. */
function stateFor(source, dest) {
  if (!isDir(dest)) return 'new';
  return sameTree(source, dest) ? 'ok' : 'update';
}

function syncOne(source, root, dryRun) {
  const dest = path.join(root.dir, SKILL_NAME);
  if (path.resolve(dest) === path.resolve(source)) {
    return { agent: root.agent, dir: root.dir, dest, state: 'source' };
  }
  const state = stateFor(source, dest);
  if (state !== 'ok' && !dryRun) {
    if (state === 'update') {
      const backup = backupDirFor(root.agent);
      copyTree(dest, backup);
      // Bound the set this very line just grew: without this the directory keeps
      // one copy of the skill per install, forever.
      pruneBackups(path.dirname(backup));
    }
    copyTree(source, dest);
  }
  return { agent: root.agent, dir: root.dir, dest, state };
}

/**
 * 把本 skill 复制到每个 agent 的 skills 根。副本彼此独立、可单独运行。
 * 只覆盖内容不同的副本，并在覆盖前备份。
 */
export function syncSelf({ source, roots, dryRun = false }) {
  return roots.map((root) => syncOne(source, root, dryRun));
}
