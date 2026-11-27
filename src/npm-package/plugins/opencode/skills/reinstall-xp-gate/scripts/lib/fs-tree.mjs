import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Filesystem primitives: existence, tree listing, hashing, copying.
 *
 * Split out of `util.mjs` (Gate 4: 13 exports, maximum 10). The remainder of
 * that module had grown into two jobs -- walking the tree and handling small
 * JSON/formatting values -- and this is the first.
 */

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.DS_Store', '.svn']);

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

export function isFile(p) {
  return Boolean(statOrNull(p)?.isFile());
}

export function isDir(p) {
  return Boolean(statOrNull(p)?.isDirectory());
}

/** `readdir` that treats an unreadable directory as empty instead of throwing. */
function dirents(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function subdirsOf(dir) {
  return dirents(dir)
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
    .map((e) => path.join(dir, e.name));
}

function filesIn(dir, base) {
  return dirents(dir)
    .filter((e) => e.isFile() && !SKIP_DIRS.has(e.name))
    .map((e) => path.relative(base, path.join(dir, e.name)).split(path.sep).join('/'));
}

/** Depth-first over every readable directory below `root`. */
function walkDirs(root) {
  const stack = [root];
  const seen = [];
  while (stack.length) {
    const dir = stack.pop();
    seen.push(dir);
    stack.push(...subdirsOf(dir));
  }
  return seen;
}

/**
 * Recursive relative-path listing, POSIX-separated and sorted.
 *
 * Iterative rather than recursive on purpose: the recursive version counted
 * itself as one more cyclomatic branch per level and had to be reasoned about
 * for stack depth on the deep trees this tool walks (`~/.local/share`).
 */
export function listFiles(root, base = root, out = []) {
  for (const dir of walkDirs(root)) out.push(...filesIn(dir, base));
  return out.sort();
}

export function hashTree(dir) {
  const h = crypto.createHash('sha256');
  for (const rel of listFiles(dir)) {
    h.update(rel);
    h.update('\0');
    try {
      h.update(fs.readFileSync(path.join(dir, rel)));
    } catch {
      return '';
    }
    h.update('\0');
  }
  return h.digest('hex');
}

export function sameTree(a, b) {
  if (!isDir(a) || !isDir(b)) return false;
  const fa = listFiles(a);
  const fb = listFiles(b);
  if (fa.length !== fb.length) return false;
  if (fa.some((f, i) => f !== fb[i])) return false;
  return hashTree(a) === hashTree(b);
}

export function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

export function copyTree(src, dest) {
  rmrf(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}
