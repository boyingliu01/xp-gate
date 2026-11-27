import fs from 'node:fs';
import path from 'node:path';

/**
 * Small value helpers: reading and writing JSON files, timestamps, NUL cleanup.
 *
 * Split out of `util.mjs` (Gate 4: 13 exports, maximum 10). These share nothing
 * with the tree walking in `fs-tree.mjs` beyond calling it.
 */

export function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
}

export function stamp(date = new Date()) {
  const part = (n) => String(n).padStart(2, '0');
  const ymd = `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}`;
  const hms = `${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
  return `${ymd}-${hms}`;
}

export function stripNul(value) {
  return String(value ?? '').replace(/\0/g, '');
}

// Backup retention moved to its own module: it is a policy ("how many copies of
// each agent's skill to keep"), not a filesystem primitive, and it was what
// pushed this module over Gate 4's export limit.
