/**
 * @module gate-capability
 * @test REQ-D2
 * @intent Publish which execution path can run which gate, derived from
 *         `githooks/gate-registry.sh` rather than declared a second time.
 *
 *         WHY THIS EXISTS. Before it, the only statement of what the CLI could
 *         run was a footnote in a design document, and it was wrong in both
 *         directions: it said the CLI was "structurally missing 0/1/5/9/11/12/13"
 *         while the CLI in fact offered all fourteen subcommands and silently
 *         declined seven of them. A reader could not tell "the CLI cannot run
 *         this gate" from "the CLI ran it and it passed", because both looked
 *         identical on the one signal that matters -- the exit code.
 *
 *         The fixed points are:
 *
 *         1. Capability is DERIVED. Each registry row declares a `hook` and
 *            whether the gate is `inline` (living inside the hook) or a separate
 *            script. A gate that lives inside the hook cannot be executed on its
 *            own, so it is `hook-only`; anything with its own implementation is
 *            `runnable`. Nothing here lists gate numbers.
 *
 *         2. `hook-only` is a first-class verdict, not a footnote: it maps to
 *            GATE_NOT_RUN and exit 2, so a caller reading only the exit status
 *            still cannot mistake it for a pass.
 *
 *         3. The vocabulary is closed (`runnable` | `hook-only`). An open one
 *            would let a new gate appear as "unknown" and be read as "fine".
 *
 *         Not here on purpose: the pre-push gates (M/M2/ML/UI/MW/S). They have
 *         no CLI subcommand at all, so reporting them as `runnable` would be a
 *         second false claim of the same kind.
 */
'use strict';

const { loadRegistry, parseRegistry, deriveGateTable } = require('./gate-identity');

/** The only two capability values the code can honour. */
const CAPABILITY = Object.freeze({
  RUNNABLE: 'runnable',
  HOOK_ONLY: 'hook-only',
});

/** Gates with no CLI subcommand exist; say so rather than implying coverage. */
const UNADDRESSED_REASON = 'no CLI subcommand is registered for pre-push gates yet';

/**
 * Derive one capability row per registry entry.
 *
 * THE TRAP THIS AVOIDS. The obvious derivation is "`impl: inline` means the body
 * lives inside the hook, therefore the CLI cannot run it". That is WRONG, and
 * measuring caught it: gate 2 is declared `inline` in the registry and the CLI
 * runs it perfectly well (`xp-gate gate-2` executes jscpd). `impl` answers "which
 * file owns this gate's implementation"; CLI runnability answers "can a separate
 * process run it". Those are orthogonal, and deriving one from the other would
 * have produced a matrix that contradicted the binary it describes -- a prettier
 * version of the footnote this module replaces.
 *
 * So runnability is asked of the thing that decides it: the runner's own
 * `preCommitOnly` declaration, which exists precisely because those gates need
 * git-staged context. The registry supplies the identity and the hook; the runner
 * supplies the capability. Neither is restated here.
 *
 * @param {Array<object>} rows registry rows
 * @param {Map<string, object>} runnerRegistry the runner's per-gate declarations
 * @returns {Array<{gate: string, slug: string, hook: string, impl: string, capability: string, reason: string|null}>}
 */
function deriveCapability(rows, runnerRegistry) {
  return rows.map((row) => {
    const isPreCommit = row.hook === 'pre-commit';

    if (!isPreCommit) {
      return {
        gate: row.number,
        slug: row.name,
        hook: row.hook,
        impl: row.impl,
        capability: CAPABILITY.HOOK_ONLY,
        reason: UNADDRESSED_REASON,
      };
    }

    const runnerGate = runnerRegistry ? runnerRegistry[String(row.number)] : null;

    if (!runnerGate) {
      // A gate the runner does not know at all. Say that, rather than guessing:
      // silently calling it runnable would promise a subcommand that errors.
      return {
        gate: row.number,
        slug: row.name,
        hook: row.hook,
        impl: row.impl,
        capability: CAPABILITY.HOOK_ONLY,
        reason: 'no CLI runner registered for this gate',
      };
    }

    if (runnerGate.preCommitOnly) {
      return {
        gate: row.number,
        slug: row.name,
        hook: row.hook,
        impl: row.impl,
        capability: CAPABILITY.HOOK_ONLY,
        reason: runnerGate.reason || 'needs git-staged context that only exists inside the hook',
      };
    }

    return {
      gate: row.number,
      slug: row.name,
      hook: row.hook,
      impl: row.impl,
      capability: CAPABILITY.RUNNABLE,
      reason: null,
    };
  });
}

/**
 * The full capability matrix for this checkout.
 * @param {Map<string, object>} [runnerRegistry]
 * @returns {{schemaVersion: string, gates: Array<object>, summary: object}}
 */
function capabilityMatrix(runnerRegistry) {
  const registry = loadRegistry();
  const rows = parseRegistry(registry.text);
  const gates = deriveCapability(rows, runnerRegistry || loadRunnerRegistry());

  const summary = gates.reduce((acc, gate) => {
    acc[gate.capability] = (acc[gate.capability] || 0) + 1;
    return acc;
  }, {});

  return {
    schemaVersion: '1.0',
    // Provenance, so the matrix can be checked against the files it came from
    // instead of being taken on faith.
    registry: registry.copies[0],
    summary: {
      total: gates.length,
      runnable: summary[CAPABILITY.RUNNABLE] || 0,
      hookOnly: summary[CAPABILITY.HOOK_ONLY] || 0,
    },
    gates,
  };
}

/**
 * The runner's own gate declarations. Loaded lazily so this module can be
 * imported by a test that only wants `deriveCapability` with injected inputs.
 * @returns {Map<string, object>|null}
 */
function loadRunnerRegistry() {
  try {
    return require('./gate-runner').GATE_REGISTRY;
  } catch {
    // A packaging fault in the runner should not make the capability report
    // explode; an empty map yields "no CLI runner registered" for every gate,
    // which is a visible, honest answer.
    return null;
  }
}

/**
 * Capability of one gate, looked up by number or slug.
 * @param {string} gateId
 * @returns {object|null}
 */
function capabilityOf(gateId) {
  const wanted = String(gateId);
  const { gates } = capabilityMatrix();
  return gates.find((gate) => gate.gate === wanted || gate.slug === wanted) || null;
}

module.exports = {
  CAPABILITY,
  deriveCapability,
  capabilityMatrix,
  capabilityOf,
  deriveGateTable,
};
