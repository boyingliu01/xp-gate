# Gate 13 — Compiler Strictness Gate (Design)

- **Date**: 2026-10-26
- **Sprint**: sprint-20261026-33 (`sprint/2026-10-26-01`)
- **Status**: DRAFT — awaiting R1 requirements review + R2 delphi-review
- **Author**: sprint-flow orchestrator (Phase 2 DESIGN)

---

## 1. Problem Statement

The compiler is the first and cheapest static analysis tool available for any
compiled language, and XP-Gate currently does not use it that way.

Measured against the current tree (`dbab0730`):

| Language | Compiler | How XP-Gate uses it today | Strict flags |
|---|---|---|---|
| TypeScript | `tsc` | Gate 1 `tsc --noEmit` + Gate 9 build integrity | ✅ `strict` |
| **C / C++** | `gcc` / `g++` / `clang++` | **never invoked for analysis.** `githooks/adapters/cpp.sh` only calls `clang-tidy`/`cppcheck`, and Gate 9's build-integrity half is TypeScript-and-Maven only | ❌ none |
| **Java** | `javac` | Gate 9 runs `mvn -q -DskipTests compile` — `-q` suppresses every non-error diagnostic | ❌ none |
| Kotlin | `kotlinc` | Gate 1 `mvn compile` piped through `grep -i "error\|fail"` | ❌ none |
| Objective-C | `clang` | `oclint` / `clang-tidy` only | ❌ none |
| Swift | `swiftc` | `swiftlint` only | ❌ none |
| Go | `gc` | `go vet` (itself a compiler-toolchain analyser) | ✅ correct |

The C/C++ case is the most severe: `githooks/adapters/cpp.sh` is 76 lines and the
compiler appears exactly once, inside `run_tests()`, as `cmake --build build/
2>&1 | tail -5` — output truncated to five lines, verdict taken from `ctest`.

### Measured evidence (reproduced during investigation)

A C++ file that looks clean, compiled with `g++ -std=c++17 -fsyntax-only -Wall -Wextra`:

```
error: 'class Base' has virtual functions and accessible non-virtual destructor [-Werror=non-virtual-dtor]
error: 'S::j' will be initialized after [-Werror=reorder]
error: suggest parentheses around assignment used as truth value [-Werror=parentheses]
error: 'memset' clearing an object of type 'std::string' with no trivial copy-assignment [-Werror=class-memaccess]
error: use of old-style cast to 'enum Color' [-Werror=old-style-cast]
error: switch missing default case [-Werror=switch-default]
```

Java, same file, three invocations:

| Invocation | Result |
|---|---|
| bare `javac` | **0 diagnostics** — raw types completely invisible |
| `javac -Xlint:all,-processing` | `warning: [rawtypes] 找到原始类型: List` |
| `javac -Xlint:all -Werror` | `error: 发现警告, 但指定了 -Werror` → exit 1 |

And Maven propagates it correctly — `maven-compiler-plugin` with
`<compilerArgs>-Xlint:all -Werror</compilerArgs>` produced `BUILD FAILURE`, exit 1,
on a raw-type fixture.

### Toolchain facts that constrain the design (all measured)

1. `gcc -fsyntax-only` writes **no** output artifact → safe inside a git hook.
2. `gcc -fanalyzer` emits **nothing** under `-fsyntax-only`; it requires `-c`.
   The GCC manual: *"The analyzer is only suitable for use on C code in this release."*
3. Unknown `-Wno-*` flags are **silently accepted** by older gcc — the
   `cc1plus: note: unrecognized command-line option ...` only appears when other
   diagnostics are also emitted. Therefore **capability probing is mandatory**;
   otherwise every new flag silently no-ops on an older toolchain and the gate
   reports PASS having checked nothing.
4. `javac` rejects an unknown `-Xlint` category outright (`error: 无效的标记`),
   so Java needs no probing — a bad category fails loudly, which is the safe direction.
5. `make` honours `CC`/`CXX`/`CFLAGS`/`CXXFLAGS` from the environment and
   command line (GNU make manual §10.3), so the project's own flags can be
   merged rather than replaced.

---

## 2. Requirements

### REQ-001 — Detect and use the project's real compiler

Gate 13 must locate the compiler the project actually builds with, in this order:

1. `$CXX` / `$CC` from the environment (what `make` itself would use)
2. `CC :=` / `CXX :=` declared in a `Makefile`
3. First available of `g++`/`clang++`/`c++` (C++), `gcc`/`clang`/`cc` (C)

**AC-001-01**: With `CXX=clang++` exported, the gate invokes `clang++`, not `g++`.
**AC-001-02**: With no compiler on `PATH`, the gate SKIPs with an install hint and never reports PASS (repository convention: *tool missing → SKIP, not BLOCK* — except Gate 8).
**AC-001-03**: The gate never silently falls back from a compiler the user explicitly named — an unusable `$CXX` is reported, not replaced.

### REQ-002 — Compiler warning checks for C and C++

Run the compiler in syntax-check mode over staged C/C++ sources with a tiered
warning set.

**AC-002-01**: `balanced` tier (default) = `-Wall -Wextra`. Verified to fire on the six bug classes listed in §1.
**AC-002-02**: `strict` tier = `balanced` plus `-Wpedantic -Wshadow -Wconversion -Wsign-conversion -Wold-style-cast -Wuseless-cast -Wformat=2 -Wcast-qual -Wcast-align -Wnull-dereference -Wnon-virtual-dtor -Woverloaded-virtual` (C++ only where the flag is C++-specific).
**AC-002-03**: A flag the detected compiler does not accept must be dropped, and the drop reported in the gate output — the gate must never fail because of a flag the toolchain does not know, and must never claim a check it did not run.
**AC-002-04**: The project's own `CFLAGS`/`CXXFLAGS` and `-I` include paths are merged in (never replaced); a user-supplied `-Werror` or `-w` in those flags is honoured.
**AC-002-05**: Header-only translation units and files with no `main` are handled via `-fsyntax-only` (no linking, no artifacts).

### REQ-003 — Strictness policy: tiered, changed-files-only `-Werror`

Applying `-Werror` to an entire legacy codebase blocks every commit on day one.
Gate 13 therefore distinguishes files by whether the commit touches them.

**AC-003-01**: A **newly added** C/C++ file with any warning in the active tier → BLOCK.
**AC-003-02**: A **modified** C/C++ file whose warning count rose above its baseline → BLOCK; at or below baseline → PASS.
**AC-003-03**: An **untouched** file is not compiled by this gate at all.
**AC-003-04**: The policy is selectable: `XP_GATE_COMPILER_STRICTNESS=strict|balanced|warn-only` (default `balanced`), where `warn-only` never blocks (mirroring Gate 12's warning-only semantics).
**AC-003-05**: Baseline state persists in `.xp-gate/compiler-warnings-baseline.json` and a missing baseline means "no history", never "zero warnings allowed" for pre-existing files.

### REQ-004 — Java compiler strictness

**AC-004-01**: Maven projects get `-Xlint:all` with `-processing` excluded, plus `-Werror`, delivered through the project's own compiler configuration.
**AC-004-02**: Gradle projects — currently a hard gap (Gate 9 skips Gradle explicitly, `#507 DR-003`) — get at least a real `compileJava` with lint enabled.
**AC-004-03**: Raw `javac` on a flat source tree is supported when no build file exists.
**AC-004-04**: Because `javac` has no per-file compilation granularity for a whole module, the changed-files `-Werror` policy of REQ-003 is applied by attributing diagnostics to their source file, not by compiling files in isolation.

### REQ-005 — `gcc -fanalyzer` for C, opt-in

**AC-005-01**: `-fanalyzer` runs on **C files only**, and only when `XP_GATE_COMPILER_ANALYZER=1` (default: off).
**AC-005-02**: It runs with `-c -o <tmp>` in a scratch directory — never in the repo tree, and never `-fsyntax-only`, which silently produces no analyzer output.
**AC-005-03**: Findings are reported with their CWE id (the compiler prints e.g. `[CWE-122] [-Wanalyzer-out-of-bounds]`).
**AC-005-04**: The analyzer never blocks on its own default setting; when enabled it participates in the same changed-files policy as REQ-003.
**AC-005-05**: The gate is lazily gated on the compiler actually supporting `-fanalyzer` (`gcc` configured without analyzer support does not).

### REQ-006 — Registration inside pre-commit

**AC-006-01**: Gate 13 is a standalone script `githooks/gate-13-compiler-strictness.sh`, sourced from `pre-commit` the same way `gate-12-file-hygiene.sh` is (existence check, then fallback to the git-root copy).
**AC-006-02**: `GATE_13_STATUS` is initialized to `SKIP` **before** the source call — `pre-commit` treats an unassigned status as "not run".
**AC-006-03**: The gate appears in the JSON aggregation (`GATES_JSON`) and the summary table.
**AC-006-04**: The script is registered in `githooks/install.sh`'s `GATE_SCRIPTS` and in both file lists of `scripts/check-hook-mirror.sh`.
**AC-006-05**: Verdict codes follow the repository contract: `0=PASS`, `1=FAIL/BLOCK`, `2=BLOCK(fail-closed)`, `3=WARN` (in the scoring denominator, never PASS). Reasons cross the subshell boundary as an `XP_G1_REASON:`-style stdout line, per the established `java.sh`/`powershell.sh` protocol.

### REQ-007 — Offline and timeboxed

**AC-007-01**: Gate 13 performs no network access. Maven/Gradle invocations run offline (`-o` / `--offline`) where possible.
**AC-007-02**: Every external command is wrapped in `timeout` when available, defaulting to a configurable budget (`.xp-gate/compiler-gate-timeout`, default 120s), and a timeout yields WARN, never PASS.

### REQ-008 — Documentation and test coverage

**AC-008-01**: `githooks/__tests__/gate-13-compiler-strictness.test.bats` covers: compiler selection, capability probing, tier selection, changed-files policy, SKIP on missing tool, verdict-code mapping, and the `XP_G1_REASON` protocol.
**AC-008-02**: The existing `cpp-gate.test.bats` `... || true` assertions are **not** modified by this sprint (they belong to the parallel refactor line); the gap is recorded as an emergent issue.
**AC-008-03**: `README.md` / `docs/CAPABILITIES.md` gate tables are updated **only** if the parallel branch has merged; otherwise the update is recorded as a follow-up to avoid a guaranteed conflict.

---

## 3. Options Considered

### Option A — Extend the existing adapters (`cpp.sh`, `java.sh`) and Gate 9

Modify `run_static_analysis` in the adapters and add compiler invocation to the
Gate 9 build-integrity block.

- **Pro**: no new gate number; reuses the existing dispatch; the Java half already
  has a Maven invocation to build on.
- **Con (decisive)**: `githooks/pre-commit`'s Gate 9 block and
  `src/build-integrity/gate-10.ts` are being rewritten **right now** by a parallel
  branch (`fix/620-psm1-discovery`, ~90 files). This option collides head-on.
- **Con**: a compiler check is a *different kind* of check from lint (Gate 1) or
  build integrity (Gate 9) — folding it in muddies the verdict semantics.

### Option B — New standalone gate, additive registration only ✅ RECOMMENDED

A new `githooks/gate-13-compiler-strictness.sh` plus one additive block in
`pre-commit` referencing it, and registration in `install.sh` +
`check-hook-mirror.sh`.

- **Pro**: near-zero conflict. Verified against the parallel branch's diff:
  `githooks/adapters/cpp.sh`, `githooks/adapters/java.sh`, `githooks/install.sh`
  and `scripts/check-hook-mirror.sh` are **all untouched** by it. The only shared
  file is `pre-commit`, and only at its tail (after Gate 12), far from the
  Gate 3/6/7/8/9 regions that branch rewrites.
- **Pro**: matches how Gate 12 was added; the registration pattern is already
  proven in this codebase.
- **Pro**: independent strictness policy, independent timeout, independent
  opt-in for `-fanalyzer`, without disturbing existing gate semantics.
- **Con**: gate count grows to 14 numbered gates (0–13); docs need a later bump.
- **Con**: two places now know about C/C++ compilation (Gate 9's TS/Java halves
  and Gate 13) — accepted, because they answer different questions ("does it
  build?" vs "is it clean?").

### Option C — Offload entirely to `clang-tidy` with `compile_commands.json`

- **Pro**: one tool, rich checks.
- **Con**: requires a configured build with export, which many repos lack; does not
  cover Java at all; and it was measured that `clang-tidy` cannot check a file it
  cannot resolve the compile flags for, whereas the compiler itself always can.

**Decision: Option B.**

---

## 4. Design Detail

### 4.1 File layout

```
githooks/gate-13-compiler-strictness.sh      # new, self-contained
githooks/__tests__/gate-13-compiler-strictness.test.bats   # new
githooks/pre-commit                          # +additive block (~8 lines)
githooks/install.sh                          # GATE_SCRIPTS += gate-13...
scripts/check-hook-mirror.sh                 # both file lists += gate-13...
```

No file under `src/npm-package/**` is touched by this sprint; the mirror sync is
deferred to after both branches merge (see §6).

### 4.2 Verdict contract

| Code | Meaning | pre-commit action |
|---|---|---|
| 0 | PASS — every compiled file clean, or within baseline | PASS |
| 1 | FAIL — new warnings on changed files | BLOCK |
| 3 | WARN — tool missing, timed out, or `warn-only` mode with findings | WARN (in denominator; never PASS) |
| 2 | BLOCK — fail-closed: compiler present but unusable (e.g. probed `-fsyntax-only` fails on a file the project compiles) | BLOCK |

### 4.3 Tier → flag table

| Flag | balanced | strict | Notes |
|---|---|---|---|
| `-Wall` `-Wextra` | ✅ | ✅ | base |
| `-Wpedantic` | — | ✅ | non-conforming code |
| `-Wshadow` | — | ✅ | name capture |
| `-Wconversion` `-Wsign-conversion` | — | ✅ | noisy in numeric code — strict only |
| `-Wold-style-cast` `-Wuseless-cast` | — | ✅ | C++ only |
| `-Wformat=2` | — | ✅ | stricter printf checking |
| `-Wcast-qual` `-Wcast-align` `-Wnull-dereference` | — | ✅ | |
| `-Wnon-virtual-dtor` `-Woverloaded-virtual` | — | ✅ | C++ only; note `-Wnon-virtual-dtor` is NOT in `-Wall` |
| `-fanalyzer` | — | — | C only, separate opt-in (`XP_GATE_COMPILER_ANALYZER=1`) |

Every flag in this table was verified accepted by gcc 16.2 during investigation;
the capability probe exists for older toolchains.

### 4.4 Capability probe algorithm

```
probe_flags() {
  # one throwaway TU that compiles cleanly
  for flag in candidate_flags; do
    if "$CXX" -fsyntax-only "$probe_tu" "$flag" 2>&1 | grep -q 'unrecognized command-line option'; then
      drop flag; record "dropped: $flag (unsupported by $($CXX --version | head -1))"
    fi
  done
}
```

Because an unknown `-Wno-*` is silent, the probe tests the **positive** form
(`-Wfoo`, which errors loudly when unknown) and only adds the `-Wno-` form for
flags that passed.

### 4.5 Changed-files policy

```
new file        -> -Werror, any warning blocks
modified file   -> count warnings; block if count > baseline[file]
untouched file  -> not compiled
```

Baseline lives in `.xp-gate/compiler-warnings-baseline.json`, mirroring
`.warnings-baseline.json` from the Boy Scout Rule (Gate 6).

---

## 5. Success Criteria

1. A legacy C++ project with pre-existing warnings can enable Gate 13 without
   every commit failing — and a newly added file with a `-Wreorder` bug **does** block.
2. A Java Maven project with `List raw = ...` in a **new** file blocks; the same
   line in an untouched file does not.
3. On a machine with no C/C++ compiler, Gate 13 SKIPs with an install hint and
   the overall verdict is not PASS.
4. An older gcc that lacks `-Wuseless-cast` runs successfully with the flag dropped
   and the drop visible in the output.
5. `git diff` for this sprint touches **no** file that the parallel
   `fix/620-psm1-discovery` branch touches, other than the tail of `pre-commit`.
6. `npm test` and the bats suite pass; the gate's own bats suite is green.

---

## 6. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Conflict with the parallel refactor branch on `pre-commit` | Additive tail-only block; verified the branch's diff does not reach it. Merge that branch first, then rebase this one. |
| `-Werror` makes adoption impossible | Tiered policy (REQ-003): only new/changed files, plus `warn-only` mode. |
| Gate slows every commit | `-fsyntax-only`, staged files only, `timeout` guard, default 120s. |
| `-fanalyzer` extremely slow | C only, off by default, opt-in. |
| Old toolchain silently ignores flags | Positive-form capability probe (REQ-002-03). |
| Maven/Gradle reach the network and hang | `-o`/`--offline` + `timeout`, timeout ⇒ WARN. |
| Mirror drift (`src/npm-package/**`) | Deliberately deferred; documented as a follow-up requiring a `sync-package-content.js --fix` run after both branches land. |
| Gate 13 report inflates the denominator | WARN stays in the denominator per the established #507 S3 semantics; SKIP only when the tool genuinely does not exist. |

---

## 7. Out of Scope

- Kotlin, Swift, Objective-C, Dart strictness (same treatment, later sprint;
  recorded as emergent issues).
- Modifying `githooks/adapters/cpp.sh` / `java.sh`.
- Fixing `cpp-gate.test.bats`'s `|| true` assertions.
- `VERSION` / `CHANGELOG.md` / `AGENTS.md` bumps — deferred past the merge.
- Adding Gate 13 to `xp-gate check` CLI dispatch (follow-up).

---

## 8. Round-2 Reconciliation (post R1/R2/R3 delphi requirements review)

The requirements were reviewed by three distinct models over three rounds
(R1 unanimous REQUEST_CHANGES with 8 criticals, R2 architecture still
REQUEST_CHANGES with 3 criticals while technical and feasibility approved,
R3 unanimous APPROVED). Every correction below is now normative for BUILD and
supersedes anything contradictory in sections 1-7 above.

The full converged statement is `.sprint-state/requirements-statement-v3.md`.
Key corrections, each traceable to a review finding:

| Finding | Correction |
|---|---|
| CI-02 (architecture) | `mvn -q` suppresses warnings, so v1's "parse warning lines" was a real self-contradiction. Maven now runs with `-B` (batch, no color) instead of `-q`, so warning lines are parseable. |
| CI-01 / FC-05 (architecture, feasibility) | Cross-compilation detection is now a pure, unit-testable predicate with three explicit conditions: non-empty `CROSS_COMPILE`; compiler basename matching `^(.*-)?(gcc\|g++\|cc\|c++\|clang\|clang++)(-[0-9.]+)?$` with a non-empty prefix; or `-dumpmachine` triple != host triple. Explicitly: empty `CROSS_COMPILE` with `CC=arm-linux-gnueabihf-gcc` IS cross-compilation. |
| CI-03 (architecture) | "Baseline only grows" describes HOOK behaviour (the hook never writes the baseline), not how a baseline comes to exist. A missing baseline therefore means: new files still get `-Werror` (their baseline is inherently 0); modified files report-only until a baseline is created by the explicit command. This removes the apparent contradiction. |
| CRITICAL-1 / FC-01 (technical, feasibility) | Baseline lives in-repo at `.xp-gate/compiler-warnings-baseline.json`, mirroring Gate 6's `.warnings-baseline.json`. Local caches were rejected because they make CI and developer verdicts diverge. |
| CRITICAL-2 / MC-01 / FC-01 (technical, feasibility) | Maven injection is no longer assumed to work. If `maven-compiler-plugin` < 3.1, no version declared, or the pom already carries `<compilerArgs>`, the gate downgrades to warn-only with an explicit `injection unreliable` line. No fake green, no non-deterministic block. |
| MA-01 (architecture) | Capability-probe results are cached in shell variables for the lifetime of one hook run only (measured cost < 1s), never persisted — a persisted cache would go stale on compiler upgrade. |
| MA-02 (architecture) | `-fanalyzer` findings share the same `count` field, but baseline entries carry `"analyzer": true\|false`; if the current run's analyzer setting differs from the baseline's, that file is reported but not compared. |
| MA-03 (architecture) | Timeout is ALWAYS verdict 3 (WARN), never 2. Verdict 2 is reserved for "the tool ran but its output is self-contradictory or unparseable". A timeout is incomplete coverage, not a wrong conclusion, and must not turn machine load into a failed commit. |
| FC-02 (feasibility) | Both `.xp-gate/compiler-gate-timeout` and `XP_GATE_COMPILER_TIMEOUT` are supported (env wins), for CI where a large changeset needs a bigger budget. |
| FC-03 (feasibility) | `XP_GATE_DISABLE_13=1` is an emergency kill switch, orthogonal to the strictness tier. |
| MA-03 / technical MAJOR (scope) | Kotlin / Swift / Objective-C / Dart strictness are explicitly OUT of this sprint. |

