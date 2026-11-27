/**
 * Filesystem and value helpers -- the module every script in this repo imports.
 *
 * WHY THIS IS A RE-EXPORT AND NOT THE IMPLEMENTATION
 * --------------------------------------------------
 * Gate 4 flagged it for owning 13 exports against a maximum of 10. As with
 * `proc.mjs`, that count was a symptom: tree walking and small JSON/formatting
 * helpers are different jobs that happened to live together.
 *
 * The importers are left alone on purpose. From their side this is one
 * "helpers" API, and rewriting a dozen import sites to lower a lint number is
 * churn. Implementations live in `fs-tree.mjs`, `json-file.mjs` and
 * `backups.mjs`.
 */

export {
  isFile,
  isDir,
  listFiles,
  hashTree,
  sameTree,
  rmrf,
  copyTree,
} from './fs-tree.mjs';

export {
  readJson,
  writeJson,
  stamp,
  stripNul,
} from './json-file.mjs';

export { BACKUP_KEEP, pruneBackups } from './backups.mjs';
