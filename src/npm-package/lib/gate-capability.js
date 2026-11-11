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
 * The invariant runs in BOTH directions. Checking only registry->runner leaves the
 * opposite rot invisible: a runner gate with no registry row would be offered as a
 * subcommand, run, and appear nowhere in this report -- so the report would say
 * "20 gates, 7 runnable" while the binary offers 21. One direction only is the
 * shape of check that looks thorough and covers half the failure.
 *
 * A pre-push registry row deliberately has no runner entry (there is no
 * subcommand), so that direction is scoped to pre-commit rows; the reverse
 * direction is scoped to runner ids that the registry does not declare at all.
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
  const declared = new Set(rows.map((row) => String(row.number)));

  // Direction 1: registry says a gate runs at commit time, runner has never heard
  // of it -> the report cannot describe it, and it would be `unreachable`.
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

  // Direction 2: runner offers a gate the registry never declares -> the CLI has a
  // subcommand for a gate with no identity, so it is missing from this report
  // while remaining executable.
  //
  // SCOPED TO NUMBERED GATES, and measuring is why. The runner also registers
  // standalone ANALYSERS that are not part of the numbered gate chain --
  // `python-health`, `test-layers`, `pbt`. They are reached through
  // `check --gates=<alias>`, they are not gate N of anything, and the registry has
  // no row to give them because there is no number to give. Counting them as drift
  // would make this check report three permanent false positives in a healthy
  // checkout, and a check that always fires teaches its reader to ignore it -- the
  // same fate as the footnote. A numbered runner id with no registry row is the
  // real defect: it is `xp-gate gate-N` with no identity behind the N.
  for (const id of Object.keys(runnerRegistry)) {
    if (!/^\d+$/.test(String(id))) continue;
    if (declared.has(String(id))) continue;
    const runnerGate = runnerRegistry[id] || {};
    problems.push({
      gate: String(id),
      slug: runnerGate.name || String(id),
      problem: 'numbered gate present in gate-runner GATE_REGISTRY, absent from githooks/gate-registry.sh '
        + '(the CLI offers a gate-N with no identity behind the number)',
    });
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
        + 'Neither source is derived from the other; detectSourceDrift cross-checks them in both directions.',
      // `unreachable` living inside a capability enum needs its justification in
      // the machine-readable output, not only in a comment: it is the one value
      // that is a defect report rather than a capability, and it is only tolerable
      // because it is required to be zero.
      unreachableMeans: 'A gate declared in the registry with no runner. Always a defect, never a '
        + 'normal state: a healthy checkout reports 0.',
      // The sentinel hazard, stated where a consumer of this JSON will read it.
      sentinel: 'runGate() returns GATE_NOT_RUN (a string) for "did not run" and a number '
        + 'otherwise. Compare with === against the sentinel or coerce explicitly; arithmetic or '
        + '`=== 0` on the return value will silently misread it.',
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
