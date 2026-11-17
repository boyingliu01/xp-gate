# SRC/MUTATION KNOWLEDGE BASE

Mutation testing for pre-push **Gate M** (plus Gate M2's test-layer helper,
consumed by `src/mock-policy/`). Multi-language: one runner per engine, driven
by the same incremental changed-files contract.

## WHY MUTATION TESTING, AND WHY IT IS THE HARDEST GATE

Coverage says a line executed. It says nothing about whether any assertion would
notice if that line were wrong — a test suite can hit 95% coverage and still
assert almost nothing. Mutation testing answers the real question: it breaks the
code deliberately and checks whether the suite goes red.

That property makes Gate M expensive in a way no other gate is: it needs a green
dry run, then one test run *per mutant*. Everything in this module exists to
make that cost survivable rather than to make it correct.

## THE DESIGN THAT KEEPS IT RUNNABLE

**Incremental by default.** Pre-push mutates only the changed files. A full run
is a deliberate, minutes-long act (`npm run test:mutation`), not something that
happens behind a push.

**A baseline converts "score" into "did this change make it worse".** Absolute
mutation score is a property of the whole codebase and moves when unrelated code
changes; it cannot gate a single push. `.mutation-baseline.json` records the
score per file, so a push is judged on *newly surviving mutants*, not on a number
that was never this contributor's to move. Initialize it before the first
incremental run — an empty baseline reports every survivor as new.

**Runners are adapter-shaped, one engine per language.** Go → go-mutant,
Python → mutmut **or** pytest-gremlins, Java/Kotlin → PIT, C#/.NET → Stryker,
TypeScript → Stryker. New engines plug in through `runners/index.ts`.

**Two Python engines exist for a platform reason, not a preference.** mutmut 3.x
is built on `fork()`, so on Windows it only runs under WSL — a native Windows
user got a structural deadlock (installed ⇒ `mutmut run` exits 1 ⇒ push blocked;
uninstalled ⇒ Gate M skips). pytest-gremlins uses mutation *switching*
(instrument once, flip an env var per mutant): no fork, no per-mutant file I/O,
natively cross-platform. Both are kept because WSL and native Windows are both
real setups here.

## THRESHOLDS AND WHERE THEY LIVE

`stryker.conf.json` holds high/low/break = 80/60/40. The break threshold is the
floor: **do not lower it below 40**, because below that a "passing" mutation
score no longer implies the suite constrains behaviour at all. Critical paths can
be forced to 80% via `.mutation-critical-paths` — that list should be short and
justified; forcing it broadly makes the gate unpassable and therefore ignored.

Mutation targets default to `src/principles/**` (excluding its own tests and
`adapters/`), and `src/mutation/**` is excluded from vitest coverage to avoid
paying to mutate the mutator.

## TRAPS

**Gate M2 is not here.** It is implemented inline in `githooks/pre-push`
(regex-counted mock keywords). Only `detectTestLayer` lives in this module and is
shared with `src/mock-policy/gate-m3.ts` — keep that export stable, or the two
gates start disagreeing about what a file is.

**On main/master, Gate M still runs** — only the Delphi code-walkthrough
validator is skipped. Do not read "pushing to main" as "mutation did not happen".

**Do not run mutation directly on `main` without worktree isolation**: Stryker
writes reports and a temporary instrumented tree, and a run killed mid-way on the
checked-out branch leaves a confusing working tree.

**A skipped Gate M is not a pass.** Every "No changed <lang> source files" line
in pre-push output means that language was not mutation-tested on this push.

## WHERE TO LOOK

| Task | File |
|---|---|
| Gate M orchestration, changed-files contract | `gate-m.ts` |
| Engine selection | `runners/index.ts` |
| Per-engine wrapper (one file each) | `runners/*-runner.ts` |
| Test-layer detection (shared with Gate M3) | `detect-ai-test.ts` |
| Stryker JSON typing | `stryker-types.ts` |
| Baseline lifecycle | `init-baseline.ts`, `update-baseline.ts` |

## COMMANDS

```bash
npm run test:mutation                              # full run (slow, deliberate)
npm run mutation:baseline:init                     # one-time baseline
npm run mutation:incremental -- --changed-files "src/foo.ts"
npx tsx src/mutation/gate-m.ts --changed-files "src/foo.ts"   # what pre-push calls
```

## WHEN YOU CHANGE SOMETHING

- Adding a language → add a runner and register it in `runners/index.ts`; the
  gate learns the language from the runner set, not from a name list here.
- Changing thresholds → they live in `stryker.conf.json`; lowering `break`
  below 40 is how this gate stops meaning anything.
- Changing `detectTestLayer` → it has two consumers (Gate M2's helpers and
  Gate M3's layer matrix); check both.
