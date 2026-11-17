# GITHOOKS KNOWLEDGE BASE

**Updated:** 2026-11-17

> **Scope of this file.** It carries what the code cannot tell you: why the hook
> layer is shaped this way, what breaks silently, and which invariants must hold.
> Gate lists, execution order, thresholds and file inventories are **not** here —
> they are generated facts and belong to the code and to `xp-gate` itself.
> See the "WHERE TO LOOK" table below.
>
> The previous revision opened with a table of every gate and its exact file, a
> line count for both hooks, and a claim of "13 adapters". The counts had already
> drifted: `pre-commit` went from 6168 lines to 1166 in one commit (#798), and the
> adapter directory now also holds gate scripts. A table that must be rewritten
> whenever a file is split is not knowledge; it is a second source of truth that
> is always the stalest one.

## WHERE TO LOOK — ASK THE TOOL

| You want | Run / open |
|---|---|
| Gate name ↔ deciding file (the authority) | `githooks/gate-registry.sh` |
| Execution order and the chain loop | `XP_GATE_ORDER` in `githooks/gate-driver.sh` |
| A gate's body | `githooks/gate-entries/gate-<KEY>-entry.sh` |
| Every gate incl. push-only | `xp-gate gate-capability` |
| Thresholds that can block a commit | `xp-gate gate-rules` |
| Which hook copy actually executes | `xp-gate doctor` |
| What recent runs did | `xp-gate audit --tail` |

`gate-list` covers commit/check gates only — push-only gates appear in
`gate-capability`. Both are generated; neither can drift from the code.

## THE SHAPE OF A HOOK, AND WHY

### `pre-commit` is a preamble, one driver call, and an epilogue

Gate logic is **not** in the hook any more. Each gate body lives in its own file
under `gate-entries/`, wrapped as `gate_<KEY>_run()`.

**To reorder gates, edit `XP_GATE_ORDER`. Never move code.**

The scar: ordering used to be the physical order of inline blocks in one very
large file. A reorder attempt moved the epilogue too, so every gate after it
silently stopped running — while the size looked right, `bash -n` passed, and
five ordering tests stayed green. A gate that blocks commits had quietly stopped
running and only a behavioural fingerprint noticed. **Line counts and syntax
checks cannot tell you whether a gate still executes.**

### Gate bodies `return`; they do not `exit`

The driver turns a non-zero return into the hook's exit status, so the EXIT trap
fires with that same status. A top-level `exit` inside a gate body bypasses the
driver's single exit point. Sub-shell exits (`( ... )`, `$( ... )`) stay `exit` on
purpose — leave them.

One body still violates this. Its observable consequences were checked and are
nil (bash fires the EXIT trap on an explicit `exit` too, and the audit record is
written just before it), so fix it for the contract, not to recover a lost
report.

### The report writer lives with one specific gate

`generate_quality_report()` is defined beside the last gate and registered as a
TOP-LEVEL function, not nested inside its `gate_N_run()`. That separation is what
lets the epilogue call it even when that gate is disabled or skipped. Do not
"tidy" it into the gate body.

### `gate_enabled()` and `XP_GATE_ONLY_GATE` key off the gate NUMBER

Which is exactly why a number is a **label** bound by the registry, and never a
position in the order list. Same for report keys, `doctor`, and `gate-coverage`.

## THE VERDICT CONTRACT

### SKIP must be recorded, not merely printed

Setting the prose to "SKIPPED" is half the job. A gate that cannot run must set
`GATE_N_STATUS="SKIP"` **and** write an audit line with a reason.

The failure mode is consistent and has recurred across four different gates: the
status variable keeps its pre-gate value (usually `PASS`), so the operator reads
"skipped" while the journal records a pass. The worse variant writes no audit
line at all, making the gate indistinguishable from one the chain never
contained.

Two rules follow, and both have been violated:

- **"Not checked" must never be recordable as "passed."**
- **An unregistered gate still runs.** A body present and ordered but missing
  from the registry is invisible to configuration and to tooling that reads the
  registry. If you add a gate, the registry row is what makes it real.

### A tool that could not RUN is not a tool that found problems

Distinguish three states, always: *found issues*, *found none*, and *did not
evaluate*. Conflating the last two is how a broken toolchain reports clean.

Security scanning is the deliberate exception: it is fail-closed. A secret
scanner that cannot run must not report success.

### Verdicts must come from structured output, not exit codes

A scanner's exit code and its severity scale are different vocabularies, and they
have historically not intersected — a gate printed PASS over a textbook finding
because it read the wrong one. Parse the structured result, treat an unknown or
missing severity tier as blocking, and fail closed (SKIP, never PASS) when the
output cannot be parsed.

## TRAPS

**`core.hooksPath` makes local edits inert.** With a global install, git executes
the copy under the user config directory, not this one. Editing here changes
nothing until you sync. This is #451, and it reads as "my edit does nothing".

**A stale adapter overrides a fresh one.** Adapters resolve through a 3-tier
chain, globally first. An old global copy wins over the tracked file and produces
a symptom that looks exactly like a product defect. Before believing any
hook-vs-direct-call difference: **`md5sum` both copies.** An adapter is stale
until proven otherwise. CI has no global copy — so if CI disagrees with local,
suspect the local install first.

**This directory holds two unrelated kinds of file.** Language adapters and gate
scripts share `adapters/` and share a mirror, so they travel and drift together.
Read the name, not the location.

**Duplicated analysis.** Some adapters define the lint step as a call to the
analysis step, so a gate that invokes both does identical work twice. It looks
like thoroughness and costs real time.

**Root-aware subdir derivation.** Nested project markers only relocate the
working directory when the repo root declares no project. One exception is
checked first: a root manifest declaring workspaces is a monorepo, not a single
project. If the root marker is ignored, gates run in the wrong directory and
false-block on root-relative paths. Multi-module Gradle / CMake / pnpm / Lerna
layouts are a known limit, not a bug to rediscover.

**Scope must be declared, not guessed.** Tool scope (which directories a
type-checker or coverage run applies to) is read from a repo-level declaration
when present, and otherwise from an existence-guarded default. Every declared
target must exist and contain matching sources; otherwise warn and skip — a typo
must degrade to SKIP, never to a false block. Some checkers also cannot be merged
into one invocation without producing spurious errors, which is why they run per
target.

## CONVENTIONS THAT ARE ACTUALLY CONSTRAINTS

- **Declare capabilities on the adapter, never enumerate language names.** A hand
  written list of languages can only ever contain what someone remembered; this
  was patched twice before becoming a rule. The default is the safe side — an
  adapter that declares nothing gets the conservative treatment.
- **One clock for durations, and never a fabricated zero.** Omitted ≠ instant.
- **No network during a gate.** Probes must not install what they are asked to
  detect; audit recording must resolve locally.
- **Short-circuit on input, and test that it is NOT over-applied.** A predicate
  written against the project instead of the change set silently converts
  "checked" into "checked nothing", so every short-circuit needs a
  "must not be short-circuited" test beside it.
- **Never probe across environments.** Run natively on Windows; the alternative
  changes `$HOME`, the interpreter and file visibility simultaneously and
  measures the difference rather than the product.
- **Edit canonical, then resync.** Mirrors are regenerated; a mirror-only edit is
  reverted at the next publish.

## ANTI-PATTERNS

- Do NOT use `--no-verify`. Process violation.
- Do NOT bypass code-walkthrough by change size — review fully, or split.
- Do NOT hardcode tool paths in an adapter; use the shared resolution.
- Do NOT reorder gates by moving code — edit the order list.
- Do NOT put `exit` inside a gate body.
- Do NOT let a gate record a verdict it did not compute.
- Do NOT add a gate without a registry row; nothing else makes it real.
- Do NOT delete or rename the code-walkthrough result before pushing.

## COMMANDS

```bash
bash githooks/install.sh          # project-local install
bash githooks/verify.sh           # sanity check

# One suite while iterating — the full set is large, do not run it blindly
bash node_modules/bats/bin/bats githooks/__tests__/<suite>.test.bats

node scripts/run-bats-ci.cjs --shard 1/4 --print-only   # what would run
node scripts/run-bats-ci.cjs --shard 1/4                # CI-shaped (serial on Windows)

xp-gate doctor                # effective hooks + drift direction
xp-gate doctor --sync-hooks   # make this directory effective
```

**Known limit, with a reason:** parallel bats shards need `flock` or `shlock`,
which Git for Windows does not ship. The runner detects this and degrades to
serial with a warning rather than failing.

## NOTES

- Report-key overrides live beside the registry rows and are read by the Node
  gate-identity helper. Compare gates on NAME, never on those keys — an override
  must not be able to excuse a mismatch.
- Pre-push validates the code-walkthrough artifact against the current HEAD; it
  does not run the review, and it must not invoke a CLI to do so.
- On main/master pushes a few gates are skipped **by design**, because the change
  was already reviewed via PR. That is intentional.
- Mutation testing in CI is narrowed to the files a PR touches for budget
  reasons, not because the full suite is broken.