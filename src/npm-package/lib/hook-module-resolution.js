#!/usr/bin/env node
/**
 * Single source of truth for hook module resolution order (#505).
 *
 * THE PROBLEM THIS SOLVES
 * The order in which a hook finds its modules (adapter-common.sh, gate-*.sh,
 * lib/*.sh, language adapters) used to be written out twice: once in shell
 * (`resolve_adapter_path()` and the `GATE_DIR` cascade in githooks/pre-commit)
 * and once in JavaScript (`listExecutedModules()` in lib/doctor.js). The two must
 * agree or doctor reports a different module surface than the one that actually
 * executes — exactly the divergence behind #495/#500. A parity test pinned the
 * behaviour, but a test only fails AFTER someone writes the wrong thing; the
 * order itself was still duplicated.
 *
 * THE FIX
 * The order lives here, in RESOLUTION_ORDER, as data. Both sides read it:
 *   - JS:  require('./hook-module-resolution.js')  (doctor.js)
 *   - SH:  the hook sources hook-module-resolution.sh, GENERATED from this file
 *          by `node scripts/generate-hook-resolution.sh` (run by sync-package-content).
 * A change to the order reaches the shell automatically; drifting requires
 * deliberately ignoring the generator.
 *
 * SCOPE NOTE: this is the ADAPTER/GATE lookup order only. It does not change
 * which files are installed or how they are copied.
 */

/**
 * Ordered resolution tiers. The first tier that contains the requested file wins.
 *
 * `base` names which directory variable supplies the root; `template` is the path
 * relative to it, with `{name}` standing for the module basename.
 *
 * `tier_id` is stable and is what shell and JS compare on, so both can report the
 * same tier for the same file without string-matching paths.
 */
const RESOLUTION_ORDER = Object.freeze([
  Object.freeze({
    tier_id: 'adapter_flat',
    base: 'ADAPTER_DIR',
    template: '{name}.sh',
    comment: 'Global install layout: modules sit flat next to adapter-common.sh',
  }),
  Object.freeze({
    tier_id: 'adapter_nested',
    base: 'ADAPTER_DIR',
    template: 'adapters/{name}.sh',
    comment: 'Nested layout under the adapter dir',
  }),
  Object.freeze({
    tier_id: 'project_nested',
    base: 'PROJECT_GITHOOKS',
    template: 'adapters/{name}.sh',
    comment: 'Project githooks adapters/',
  }),
  Object.freeze({
    tier_id: 'script_nested',
    base: 'SCRIPT_DIR',
    template: 'adapters/{name}.sh',
    comment: 'Hook directory fallback',
  }),
]);

/**
 * Order used when resolving GATE scripts. Gates are looked up flat first
 * (co-located with adapter-common.sh), then in the project githooks root.
 */
const GATE_RESOLUTION_ORDER = Object.freeze([
  Object.freeze({
    tier_id: 'gate_adapter_dir',
    base: 'ADAPTER_DIR',
    template: '{name}',
    comment: 'Gates co-located with adapter-common.sh',
  }),
  Object.freeze({
    tier_id: 'gate_project',
    base: 'PROJECT_GITHOOKS',
    template: '{name}',
    comment: 'Project githooks/',
  }),
  Object.freeze({
    tier_id: 'gate_script_dir',
    base: 'SCRIPT_DIR',
    template: '{name}',
    comment: 'Hook directory fallback',
  }),
]);

/**
 * Order in which the hook picks the directory that holds adapter-common.sh
 * (ADAPTER_DIR). Same reasoning as RESOLUTION_ORDER: this cascade decides which
 * tree every later lookup searches, so it must have one definition.
 *
 * `probe` is the file whose presence in `base` makes that tier win.
 */
const ADAPTER_DIR_ORDER = Object.freeze([
  Object.freeze({
    tier_id: 'global',
    base: 'GLOBAL_ADAPTER_DIR',
    probe: 'adapter-common.sh',
    comment: '~/.config/xp-gate/adapters — global install',
  }),
  Object.freeze({
    tier_id: 'project',
    base: 'PROJECT_GITHOOKS',
    probe: 'adapter-common.sh',
    comment: '<repo>/githooks — per-project init',
  }),
  Object.freeze({
    tier_id: 'script',
    base: 'SCRIPT_DIR',
    probe: 'adapter-common.sh',
    comment: 'Hook directory fallback',
  }),
]);

/**
 * The probe file used to decide which tier supplies gate scripts. It is the
 * first gate, so it is present wherever the gate suite is installed.
 */
const GATE_PROBE = 'gate-3.sh';

module.exports = {
  RESOLUTION_ORDER,
  GATE_RESOLUTION_ORDER,
  ADAPTER_DIR_ORDER,
  GATE_PROBE,
};
