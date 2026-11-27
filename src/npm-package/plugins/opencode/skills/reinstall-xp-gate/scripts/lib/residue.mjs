import fs from 'node:fs';
import path from 'node:path';
import { hashTree, isDir, isFile, listFiles, rmrf } from './util.mjs';

/** 标记扫描上限：避免一个巨大的第三方目录拖住卸载流程。 */
export const MARKER_SCAN_LIMIT = 300;

const XP_GATE_MARKER = /xp-gate/i;

/**
 * 备份再删除：xp-gate 的 purge 会整目录删用户配置，所有破坏性动作必须先留证据。
 * 单文件走 copyFile，目录走整树复制。
 *
 * 抽成独立模块的原因是可测性：调用方是顶层立即执行的脚本，逻辑写错没有任何
 * 东西能拦住，而这里每个分支都在删用户文件。
 */
export function backupThenRemove(abs, runDir, label, isFileEntry = false) {
  const dest = path.join(runDir, 'residue', label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isFileEntry) fs.copyFileSync(abs, dest);
  else fs.cpSync(abs, dest, { recursive: true, force: true });
  rmrf(abs);
}

/** 目录内任意文件含 xp-gate 标记才算我们的产物，避免误删同名的用户目录。 */
export function hasXpGateMarker(dir) {
  return listFiles(dir).slice(0, MARKER_SCAN_LIMIT).some((rel) => fileHasMarker(path.join(dir, rel)));
}

function fileHasMarker(abs) {
  try {
    return XP_GATE_MARKER.test(fs.readFileSync(abs, 'utf8'));
  } catch {
    /* 二进制/无权限文件跳过 */
    return false;
  }
}

/**
 * 对比旧发布包哈希，把 agent 目录里的 skill 副本分成「逐字节一致（可删）」
 * 与「用户改过（保留并备份）」两类。hashFn 可注入，便于测试。
 */
export function scanSkillResidue(roots, oldHashes, hashFn = hashTree) {
  const classified = roots.flatMap((root) => safeReaddir(root.dir)
    .map((entry) => classifyCopy(root, entry, oldHashes, hashFn))
    .filter(Boolean));
  return {
    identical: classified.filter((h) => h.same).map((h) => h.row),
    modified: classified.filter((h) => !h.same).map((h) => h.row),
  };
}

/**
 * One directory in an agent skills root, classified against the old package.
 *
 * Returns null for anything that is not a directory we shipped: a name absent
 * from `oldHashes` is a user's own skill and must never be classified, let alone
 * deleted. This check happens BEFORE hashing so an unrelated tree is never read.
 */
function classifyCopy(root, entry, oldHashes, hashFn) {
  if (!entry.isDirectory() || !oldHashes.has(entry.name)) return null;
  const dir = path.join(root.dir, entry.name);
  return {
    same: hashFn(dir) === oldHashes.get(entry.name),
    row: { agent: root.agent, dir, name: entry.name },
  };
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** 发布包内每个 skill 目录的内容哈希，供 pruneDeadRoots 逐字节比对。 */
export function contentHashes(pkg) {
  const map = new Map();
  for (const name of skillNames(path.join(pkg, 'skills'))) {
    map.set(name, hashTree(path.join(pkg, 'skills', name)));
  }
  return map;
}

/** Subdirectories of `<pkg>/skills` that actually contain a SKILL.md. */
function skillNames(dir) {
  return safeReaddir(dir)
    .filter((entry) => entry.isDirectory() && isFile(path.join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
}

/**
 * install-skill 只看目录是否存在，会把 skill 写进已卸载 agent 的残留目录。
 * 这里只删与发布包逐字节一致的副本；用户改过的副本保持原样。
 */
export function pruneDeadRoots(pkg, deadRoots, hashFn = hashTree, remove = rmrf) {
  const content = contentHashes(pkg);
  return deadRoots.reduce((sum, root) => sum + pruneRoot(root, content, hashFn, remove), 0);
}

/** Delete the byte-identical copies in one agent root; leave edited ones. */
function pruneRoot(root, content, hashFn, remove) {
  const matched = [...content].filter(([name, expected]) => isIdenticalCopy(path.join(root.dir, name), expected, hashFn));
  matched.forEach(([name]) => remove(path.join(root.dir, name)));
  return matched.length + (removeStraySelfCopy(root.dir, remove) ? 1 : 0);
}

/** Only an exact match on BOTH existence and content is ours to delete. */
function isIdenticalCopy(dest, expected, hashFn) {
  return isDir(dest) && hashFn(dest) === expected;
}

/**
 * The skill's own copies, current name first then the pre-2.0.0 name.
 *
 * The rename is why this is a list. Every machine that ran the old installer
 * carries `xp-gate-reinstall/` in each agent root; the package no longer ships
 * anything under that name, so nothing would ever update those copies again and
 * they would sit forever looking like a live skill. Sweeping them here is what
 * makes the rename automatic instead of a manual chore on every dev box.
 */
const SELF_NAMES = ['reinstall-xp-gate', 'xp-gate-reinstall'];

/**
 * The skill's own copy is NOT part of the published package, so it is absent
 * from `contentHashes` and would survive the loop above. `install.mjs` writes it
 * into every agent root it can see, including ones already judged dead.
 *
 * `remove` is used only for a copy this skill actually wrote -- a self copy has
 * no package hash to compare against, so the marker is the SKILL.md `name:`
 * field. An edited copy under either name is user data and stays.
 */
function removeStraySelfCopy(rootDir, remove) {
  return SELF_NAMES.filter((name) => isOurSelfCopy(path.join(rootDir, name)))
    .map((name) => {
      remove(path.join(rootDir, name));
      return true;
    })
    .length;
}

/** The name this skill carried before 2.0.0. */
const LEGACY_SELF_NAME = 'xp-gate-reinstall';

/**
 * Delete a pre-2.0.0 copy under the old name from ONE agent root.
 *
 * Separate from `pruneDeadRoots` because that one only ever receives agents
 * judged dead. The rename has to reach every root still in use: measured during
 * the real 2.0.0 install, six new copies were written and all five old ones
 * stayed behind, because nothing in the install path looked at the legacy name.
 * `install.mjs` calls this right after writing the current copy.
 *
 * The current name is never touched -- deleting it would undo the install this
 * sweep is part of. An edited legacy copy is user data and stays, by the same
 * marker rule as every other copy here.
 *
 * @returns {number} 1 when a legacy copy was removed, else 0
 */
export function sweepLegacySelfCopy(rootDir, remove = rmrf) {
  const legacy = path.join(rootDir, LEGACY_SELF_NAME);
  if (!isOurSelfCopy(legacy)) return 0;
  remove(legacy);
  return 1;
}

/** True only when the directory carries OUR skill marker, not merely our name. */
function isOurSelfCopy(dir) {
  const skillFile = path.join(dir, 'SKILL.md');
  if (!isFile(skillFile)) return false;
  try {
    // Compare the `name:` line literally rather than building a RegExp from a
    // variable. The names are internal constants so there is no injection here,
    // but a dynamic regexp is both slower and flagged by every SAST ruleset --
    // the finding would have to be suppressed on every future run, and a
    // suppressed finding is one nobody reads. Splitting the field is exact, which
    // is what this predicate needs anyway: `name: reinstall-xp-gate-fork` is a
    // different skill and must not be swept as ours.
    const lines = fs.readFileSync(skillFile, 'utf8').split('\n').slice(0, 20);
    const nameLine = lines.find((line) => line.trim().startsWith('name:'));
    if (!nameLine) return false;
    const declared = nameLine.slice(nameLine.indexOf(':') + 1).trim();
    return SELF_NAMES.includes(declared);
  } catch {
    return false;
  }
}
