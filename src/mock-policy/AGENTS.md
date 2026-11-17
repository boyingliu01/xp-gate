# SRC/MOCK-POLICY KNOWLEDGE BASE

Mock layering for pre-push Gate M3: internal dependencies get real
implementations, external ones get mocks, and every pending dependency carries a
removal plan.

## WHY THIS GATE EXISTS

A test that mocks the very thing it is testing always passes. That is not a weak
test — it is a test that reports success while measuring nothing, and the
failure surfaces as an incident rather than a red build. Gate M3's whole job is
to make the difference between "asserted against the real implementation" and
"asserted against my own stub" visible, because a reviewer cannot reliably tell
those apart by reading an import line.

The policy is expressed as a **decision matrix keyed by test layer**, not a list
of banned calls. The layer is what makes a mock acceptable: mocking an external
service in an integration test is correct; mocking the module under test never
is, and no amount of annotation changes that.

## THE INVARIANTS THAT MATTER

**Test layer decides the rule.** e2e = always real. unit (lenient) = always mock
allowed, unchecked. unit (strict) = treated as integration-like. integration =
decided by dependency scope. Layer detection is delegated to
`src/mutation/detect-ai-test.ts` — deliberately not reimplemented here, so the
two gates cannot disagree about what a file is.

**Scope decides mock vs real for integration tests.** An import is internal
(resolves inside the project boundary) → must be real. External (Node builtin,
npm package outside the boundary) → mock allowed. Pending (declared but not yet
implemented) → mock allowed only with a removal plan.

**`@mock-justified` is the escape hatch for pending dependencies in integration
tests, and it demands a removal plan.** Not a suppression: a pending dependency
without one is exactly the "mock forever" state the gate exists to prevent.

**Default severity is `warning` — Gate M3 does not block a push.** This is
intentional while the matrix is being adopted; it means a green push is not
evidence that mock layering is satisfied. Read the gate's output, do not rely on
the exit status.

**Config resolves `.mockpolicyrc` (JSON) > `.xp-gate/mock-policy.yaml` (YAML) >
built-in defaults**, and is Zod-validated before use. A malformed config fails
rather than silently falling back to defaults — a gate graded against a config
nobody wrote is worse than a gate that refuses to run.

## TRAPS

**`gate-m3.ts`'s helpers are deliberately not exported** (beyond
`runGateM`/`main`). Importing them couples callers to internals the matrix is
free to change; go through `runGateM`.

**The scanner touches the real filesystem.** There is no virtual-FS abstraction,
so scope resolution reflects the working tree — a file that exists only in the
index, or a path that requires a build step to exist, classifies as
unimplemented. Tests account for this by building real temp directories under
`os.tmpdir()`.

**`workspace:*` dependencies are skipped** when reading `package.json`, because
they are neither versioned releases nor external services.

**Do not set severity to `error` without running the full integration suite
first.** The matrix's default is `warning` precisely because the codebase's
current mock usage has not been validated against a blocking threshold.

## WHERE TO LOOK

| Task | File |
|---|---|
| Types / interfaces | `types.ts` |
| Zod config schema | `schema.ts` |
| Config loading + fallback chain | `config.ts` |
| Internal / external / pending classification | `scope-scanner.ts` |
| Per-layer mock decision matrix | `mock-decision-engine.ts` |
| Gate orchestration, per-file validation | `gate-m3.ts` |

For the exact exported symbol names and signatures, read the files — a list here
would rot, and the file *is* the answer.

## COMMANDS

```bash
npx tsx src/mock-policy/gate-m3.ts <test-file>...   # run Gate M3 on given files
npx vitest run src/mock-policy/__tests__/           # this module's tests
```

## WHEN YOU CHANGE SOMETHING

- Adding a test layer → update the matrix in `mock-decision-engine.ts` **and**
  `src/mutation/detect-ai-test.ts`; the two must agree or files classify into a
  layer the matrix has no rule for.
- Changing severity → run the whole suite first; `warning` became the default
  because blocking was never validated against real usage.
- Coverage exclusion for this directory is controlled by the vitest config, not
  from here.
