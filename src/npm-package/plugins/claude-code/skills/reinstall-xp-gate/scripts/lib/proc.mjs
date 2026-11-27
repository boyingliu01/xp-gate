/**
 * Process utilities -- the module every script in this repo imports from.
 *
 * WHY THIS IS NOW A RE-EXPORT AND NOT THE IMPLEMENTATION
 * ------------------------------------------------------
 * Gate 4 flagged this file for owning 20 exports against a maximum of 10. The
 * count was a symptom, not the problem: three unrelated jobs had grown here --
 * starting child processes, locating the installed xp-gate, and abstracting the
 * platform -- so fixing the number by reading the config differently would have
 * left the coupling in place.
 *
 * The jobs now live in `spawn.mjs`, `xp-cli.mjs` and `platform.mjs`. This file
 * keeps exporting the same names, because its importers were never wrong: from
 * their side it is one coherent "process utilities" API, and rewriting a dozen
 * import sites to chase a lint number is churn, not design.
 *
 * The dependency direction is acyclic: platform <- spawn <- xp-cli.
 */

export { HOME, isWindowsShim, withPlatform, firstExisting, parseWhichOutput } from './platform.mjs';
export {
  PROBE_TIMEOUT_MS,
  XP_GATE_SLOW_OP_TIMEOUT_MS,
  effectivePath,
  envWithPath,
  run,
  probe,
  which,
  toolVersion,
  npmCli,
  runNpm,
} from './spawn.mjs';
export { resetPackageDir, packageDir, xp, xpJson, gitConfig } from './xp-cli.mjs';
