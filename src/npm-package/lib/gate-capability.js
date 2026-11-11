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

/** The only capability values the code can honour. */
const CAPABILITY = Object.freeze({
  /** A separate process can run this gate on its own and produce a verdict. */
  RUNNABLE: 'runnable',
  /** Runs during `git commit` only: needs the staged set, which no other caller has. */
  COMMIT_ONLY: 'commit-only',
  /** Runs during `git push`. Executes outside a hook like any gate, but has no subcommand. */
  PUSH_ONLY: 'push-only',
  /** Registered nowhere: say so rather than implying a surface can run it. */
  UNREACHABLE: 'unreachable',
});

const ALL_CAPABILITIES = Object.freeze(Object.values(CAPABILITY));

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

    // Pre-push gates are NOT "hook-only". They run outside a hook like any gate
    // -- `git push` invokes them -- they simply have no `xp-gate` subcommand. The
    // first version of this module called them hook-only and explained the
    // difference in a reason string, which is exactly the kind of conflation the
    // module exists to remove: a closed enum whose `--json` output is wrong on six
    // of twenty entries is worse than no enum, because a machine reads it.
    if (!isPreCommit) {
      const hasSubcommand = Boolean(runnerRegistry && runnerRegistry[String(row.number)]);
      return {
        gate: row.number,
        slug: row.name,
        hook: row.hook,
        impl: row.impl,
        capability: hasSubcommand ? CAPABILITY.RUNNABLE : CAPABILITY.PUSH_ONLY,
        reason: hasSubcommand ? null : 'runs on git push; no xp-gate subcommand is registered for it',
      };
    }

    const runnerGate = runnerRegistry ? runnerRegistry[String(row.number)] : null;

    if (!runnerGate) {
      // Registered in the hook but unknown to the runner: a definition fault, not
      // a capability. Reporting `commit-only` here would hide a gate that runs at
      // commit time but that the CLI cannot even name.
      return {
        gate: row.number,
        slug: row.name,
        hook: row.hook,
        impl: row.impl,
        capability: CAPABILITY.UNREACHABLE,
        reason: 'declared in the registry with no CLI runner registered for it',
      };
    }

    if (runnerGate.preCommitOnly) {
      return {
        gate: row.number,
        slug: row.name,
        hook: row.hook,
        impl: row.impl,
        capability: CAPABILITY.COMMIT_ONLY,
        reason: runnerGate.reason || 'needs the git-staged set, which exists only during git commit',
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
 * Check the two sources against each other and report disagreement.
 *
 * WHY THIS EXISTS. Capability needs two facts: which hook owns a gate (the
 * registry) and whether a separate process can run it (the runner's
 * `preCommitOnly`). Reading one and inferring the other was measured wrong --
 * gate 2 is declared `impl:inline` and the CLI runs it fine. Keeping both is
 * therefore correct, but two sources with no cross-check is how the footnote this
 * module replaces went stale unnoticed.
 *
 * The invariant is narrow and checkable: every gate the registry declares for
 * pre-commit must be known to the runner. A gate added to the registry alone is
 * exactly the drift that would make this report lie.
 *
 * @param {Array<object>} rows registry rows
 * @param {Map<string, object>|null} runnerRegistry
 * @returns {Array<{gate: string, slug: string, problem: string}>}
 */
function detectSourceDrift(rows, runnerRegistry) {
  if (!runnerRegistry) {
    return [{ gate: '*', slug: '*', problem: 'the runner registry could not be loaded at all' }];
  }
  const problems = [];
  for (const row of rows) {
    if (row.hook !== 'pre-commit') continue;
    if (!runnerRegistry[String(row.number)]) {
      problems.push({
        gate: row.number,
        slug: row.name,
        problem: 'declared in githooks/gate-registry.sh for pre-commit, absent from gate-runner GATE_REGISTRY',
      });
    }
  }
  return problems;
}

/**
 * The full capability matrix for this checkout.
 * @param {Map<string, object>} [runnerRegistry]
 * @returns {{schemaVersion: string, gates: Array<object>, summary: object}}
 */
function capabilityMatrix(runnerRegistry) {
  const registry = loadRegistry();
  const rows = parseRegistry(registry.text);
  const resolvedRunner = runnerRegistry === undefined ? loadRunnerRegistry() : runnerRegistry;
  const gates = deriveCapability(rows, resolvedRunner);
  const drift = detectSourceDrift(rows, resolvedRunner);

  const summary = gates.reduce((acc, gate) => {
    acc[gate.capability] = (acc[gate.capability] || 0) + 1;
    return acc;
  }, {});

  return {
    schemaVersion: '1.1',
    // Which source answers which question, stated in the output itself so a
    // reader does not have to infer the authority from the code.
    sources: {
      identity: 'githooks/gate-registry.sh (owns name, number, hook, impl)',
      runnability: 'src/npm-package/lib/gate-runner.js GATE_REGISTRY.preCommitOnly (owns whether a separate process can run it)',
      note: 'These are orthogonal: gate 2 is `impl:inline` in the registry AND runnable by the CLI. '
        + 'Neither source is derived from the other; detectSourceDrift cross-checks them.',
    },
    registry: registry.copies[0],
    summary: {
      total: gates.length,
      runnable: summary[CAPABILITY.RUNNABLE] || 0,
      commitOnly: summary[CAPABILITY.COMMIT_ONLY] || 0,
      pushOnly: summary[CAPABILITY.PUSH_ONLY] || 0,
      unreachable: summary[CAPABILITY.UNREACHABLE] || 0,
    },
    // Empty means the two sources agree. Non-empty is a defect report, not a
    // capability report, and is surfaced first in the rendered output.
    drift,
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
  ALL_CAPABILITIES,
  deriveCapability,
  detectSourceDrift,
  capabilityMatrix,
  capabilityOf,
  deriveGateTable,
};
