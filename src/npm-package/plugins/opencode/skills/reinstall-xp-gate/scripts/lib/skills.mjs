import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './proc.mjs';
import { copyTree, isDir, isFile, listFiles, pruneBackups, sameTree } from './util.mjs';

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Names of the skills the installed package ships (`<pkg>/skills/<name>/SKILL.md`). */
export function bundledSkills(pkgDir) {
  if (!pkgDir) return [];
  return safeReaddir(path.join(pkgDir, 'skills'))
    .filter((e) => e.isDirectory() && isFile(path.join(pkgDir, 'skills', e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();
}

/**
 * How a deployed copy compares to the bundled skill.
 *
 * `ok`      identical tree
 * `drift`   a shipped file differs or is missing -- the copy is damaged
 * `extra`   every shipped file matches, but the copy has files the package does
 *           not ship
 * `missing` nothing deployed
 *
 * MEASURED: ~/xp-gate/skills/sprint-flow carries its own `__tests__/`, which the
 * npm package does not include. All 26 shipped files matched byte for byte, yet
 * a whole-tree hash called it `drift` and `verify` reported FAIL -- the
 * distribution was correct and the verdict was wrong. `extra` keeps that visible
 * without claiming the copy is damaged: a stray file can still shadow real
 * content, so it is not `ok` either.
 */
function copyState(src, dest) {
  if (!isDir(dest)) return { state: 'missing', extra: [] };
  if (sameTree(src, dest)) return { state: 'ok', extra: [] };
  const shipped = listFiles(src);
  const local = listFiles(dest);
  const localSet = new Set(local);
  // A shipped file that is absent locally makes this 'drift' immediately.
  const intact = shipped.every((rel) => localSet.has(rel) && contentHash(src, rel) === contentHash(dest, rel));
  if (!intact) return { state: 'drift', extra: [] };
  const shippedSet = new Set(shipped);
  const extra = local.filter((rel) => !shippedSet.has(rel));
  // Name the extras: "there are extra files" without saying which is not
  // actionable, and the whole point of keeping `extra` visible is to let the
  // reader decide whether they belong.
  return { state: extra.length ? 'extra' : 'drift', extra };
}

/** Hash of one file inside a tree, or '' when it cannot be read. */
function contentHash(root, rel) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
  } catch {
    return '';
  }
}

/**
 * 每个 agent 根 × 每个发布包 skill 的状态：ok / drift / missing。
 * 只读，不改盘；state 的基准是当前安装的发布包。
 */
export function planSkillCopies(pkgDir, roots) {
  const names = bundledSkills(pkgDir);
  const rows = [];
  for (const root of roots) {
    for (const name of names) {
      const src = path.join(pkgDir, 'skills', name);
      const dest = path.join(root.dir, name);
      const { state, extra } = copyState(src, dest);
      rows.push({ agent: root.agent, root: root.dir, name, src, dest, state, extra });
    }
  }
  return { names, rows };
}

export function summarizeRows(rows) {
  const byAgent = new Map();
  for (const row of rows) {
    const entry = byAgent.get(row.agent) || { total: 0, ok: 0, drift: 0, missing: 0, extra: 0 };
    entry.total += 1;
    entry[row.state] += 1;
    byAgent.set(row.agent, entry);
  }
  return byAgent;
}

export function safeLabel(name) {
  return String(name).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'agent';
}

/**
 * 补齐缺失、覆盖漂移。漂移副本先备份，用户改动不会被静默丢掉。
 * @returns {Array} 实际处理的 row（含 applied / backup）
 */
export function applySkillCopies(rows, { backupRoot, dryRun = false } = {}) {
  return rows.filter((row) => row.state !== 'ok').map((row) => applyOne(row, { backupRoot, dryRun }));
}

function applyOne(row, { backupRoot, dryRun }) {
  if (dryRun) return row;
  if (row.state === 'drift' && isDir(row.dest) && backupRoot) {
    row.backup = path.join(backupRoot, safeLabel(row.agent), row.name);
    copyTree(row.dest, row.backup);
    pruneBackups(backupRoot);
  }
  copyTree(row.src, row.dest);
  row.applied = true;
  return row;
}

export function skillsBackupRoot() {
  return path.join(HOME, '.local', 'share', 'xp-gate', 'skills', '.backups');
}
