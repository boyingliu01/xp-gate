# 0003. A declaration is not enforcement: every gate claim carries a test that proves it can fail

## Status

Accepted

## Context

Over 2026-11-18/19, four separate defects were found in this repository, in three
different gates, and they were the same defect wearing different clothes. Each
gate *declared* a capability it did not *execute*:

| Gate | Claim | Reality |
|---|---|---|
| 6 | `forbiddenImports` blocks edges | Parsed into a TSV column that no code read. Dead config. |
| 6 | imports are scanned | Only `from "..."` matched. 98 `.cjs` files in this repo (14 under `src/npm-package`, 52 under `scripts`, 4 under `githooks`) and every `require()` edge were invisible. |
| 1 | test files are type-checked | The generated tsconfig used `src/**/__tests__/**` in `include`, where TypeScript rejects a trailing `**` (TS5010). tsc aborted; the gate reported "your code has type errors". |
| 6 | this repo's layers are declared | `architecture.yaml` named the canonical Clean Architecture five under `src/`. None of those directories has ever existed here. 0 of 774 files classified, for ~207 days. |

What these share is not a coding mistake. It is a **shape**: the artefact that
describes the behaviour and the artefact that performs it were allowed to
disagree, and nothing was positioned to notice. The config read as enforcement.
The prose read as measurement. A reader who believes a boundary is enforced stops
checking it — which is exactly why these survived so long.

Three near-misses during the same work made the pattern harder to dismiss:

1. The first mutation probe for `forbiddenImports` "passed" — because the probe
   file's relative path was one level too shallow and resolved to a file that did
   not exist. A bad probe reports success.
2. Fixing `architecture.yaml` by declaring all of `src/npm-package/**` as
   generated produced **7 false violations**, because `lib/` and `scripts/` are
   canonical there, not mirrors. A model wrong in the strict direction is still
   wrong, and worse, it gets baselined rather than fixed.
3. Adding the 5th diagnostic column silently broke the baseline ledger's key
   matching, turning accepted debt back into blocking violations. Two existing
   tests caught it; reading the diff had not.

## Decision

We treat **"a gate declares X" and "a gate can prove X" as separate claims**, and
only the second is allowed to be written as if it were true.

Concretely, when a gate gains or claims a capability:

1. **The capability ships with a test that fails without it.** For verdict logic
   the test must be shown red first, and the red state must be reached by
   reverting the fix, not by reasoning about it.
2. **The test asserts on the subject, not on its own scaffolding.** The Gate 1
   regression asserts that tsc *reports the test file* and *rejects no config* —
   not merely "exit 0", because a pass that checks nothing also exits 0.
3. **Anti-over-reach is a second test.** Every narrowing rule gets a neighbour
   asserting it does not fire when it should not (`forbiddenImports` does not
   trigger on a layer that is never imported; the corrected Gate 1 config does not
   invent findings on a clean project).
4. **A capability that cannot run reports as "not checked", never as a verdict.**
   Gate 1 now distinguishes three states — clean, found errors, config rejected —
   because a TS5xxx complaint alone does not mean nothing was evaluated; tsc keeps
   checking and reports real errors alongside it. The two are separated by
   counting, and only "all diagnostics are config diagnostics" degrades to exit 2.
5. **Declarations that describe this repository are verified against this
   repository.** `architecture.yaml` is checked by running the checker on the repo
   itself as part of the work, not by reading it.

## Consequences

### Positive

- The four defects above are now pinned: reverting any fix turns a specific named
  test red. `gate-6-layers.test.bats` grew from 18 to 23 tests; the Gate 1 suite
  gained two.
- The checker now classifies 772 of 772 files (0 → 768 when the declaration was
  corrected), so "0 violations" finally means something rather than reporting a
  vacuous green.
- The pattern has a name, which makes it findable: the next time a config field
  is added, the question "who reads this?" has an obvious answer location.

### Negative

- **Test count is not the same as coverage of the claim.** All 23 layer tests pass
  and `forbiddenImports` could still have a form we have not exercised (a glob
  that spans two layers, for instance). The tests pin what was measured, not what
  was imagined.
- **This ADR does not mechanically prevent recurrence.** It is a convention plus
  four existing tests. Nothing blocks a future contributor from adding a config
  field that no code reads. The honest mitigation is the audit procedure below,
  and it depends on someone running it.
- The mutation discipline is slow on this machine: the full bats suite times out
  in the foreground and must be run as a background job.

### Neutral

- Two of the four defects were in code written to fix the previous one (#686's
  fix contained the `forbiddenImports` hole). Recursion does not guarantee
  correctness; it only guarantees the same mistake can be repeated one level
  deeper.

## Alternatives Considered

### Adopt an ADR + C4 diagram workflow for the design phase

This was the original proposal: maintain architecture diagrams and decision
records so that drift becomes visible earlier.

Rejected as the *primary* mechanism, on measurement. The four defects above would
have been caught by **none** of it. A C4 diagram of this repository would have
shown `githooks/` and `src/` and would have been correct the whole time; the bug
was that a field was parsed and dropped. 80% of a C4 diagram's content is
recomputable from the code, so it is not a second source of truth but a cheap
copy of the first — and copies drift silently, which is the failure mode being
fixed. Meanwhile the evidence for "high defect rate" is not architectural:
390 of 814 commits in the 30 days to 2026-11-19 were fixes, and the dominant
family is documented above — detectors that cannot fail, not boundaries that
were crossed.

The narrow part that survives is the ADR itself, for the one thing code cannot
carry: **why** an alternative was rejected. That is this document.

### Rely on code review to catch declared-but-dead configuration

Rejected: it was tried implicitly. All four defects were present through many
reviews, because the configuration looked correct and the surrounding code looked
principled. Reading cannot distinguish "enforced" from "reads as enforced" — only
executing a mutation can.

### Fail closed whenever a gate's configuration is unparseable

Rejected as too blunt for Gate 1. Failing closed on any TS5xxx diagnostic would
mask real type errors that tsc reports in the same run, which trades one silent
failure for another. Counting config diagnostics against all diagnostics keeps
both facts visible.

## Audit procedure this ADR commits us to

When adding or reviewing a gate capability, answer these in the commit or PR:

1. What reads this declaration? Name the line.
2. What test fails if the reading code is removed? Show it red.
3. What does the test assert that a vacuous pass would not satisfy?
4. Is there a neighbouring case that must NOT fire?
5. If it cannot run, what does it report instead — and is that distinguishable
   from a pass?

## References

- `githooks/gate-6-layers.sh`, `githooks/lib/layer-baseline.cjs`
- `githooks/lib/typecheck.sh`, `githooks/__tests__/gate-1-tsc-test-files.test.bats`
- `githooks/__tests__/gate-6-layers.test.bats`
- `scripts/__tests__/arch-rules-doc-honesty.test.cjs` — the exemplar of the rule
  this ADR generalises: it asserts that a doc's claims cannot silently become false
- #686 (the original "declared but not enforced" report)
- ADR-0002 (`arch rules vs layer contract`) — the same tension between two
  declarations of one concept
