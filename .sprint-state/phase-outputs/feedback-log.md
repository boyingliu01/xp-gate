# Phase 4: FEEDBACK — sprint-2026-06-30-01 (Gate M Multi-Language)

## Sprint Summary
- **Goal**: Extend Gate M mutation testing from TypeScript-only to Go + Java + Kotlin (C++ deferred)
- **Duration**: ~6h (ISOLATE → REVIEW completed)
- **Branch**: sprint/2026-06-30-01 (worktree isolated)
- **Files Changed**: 9 source files, 4 new files (+725/-231)
- **Test Change**: 1689 → 1725 (+36 PitestRunner tests, all passing)
- **Delphi**: DESIGN APPROVED (0.67 consensus, 2 rounds), CODE-WALKTHROUGH APPROVED (1.0 consensus, 2 rounds)

## What Went Well
1. **Code-walkthrough caught 8 real issues** — gradle path, test-compile, GOPATH fallback, gradlew full path, JSON comment, JSON schema fields, dir.replace, status variables. All fixed before SHIP.
2. **PitestRunner dual-buildtool (Maven+Gradle)** — clean architecture with `detectBuildTool()` pattern matching existing MutmutRunner
3. **Per-push sections** (not unified loop) — intentional for auditability; each language has independent status journaling
4. **Delegation discipline** — 3 parallel agents (pre-push/githooks, gate-m/index.ts, PitestRunner+tests) ran independently with clear prompts
5. **npm-package mirror sync** — `cp` after test fix ensured byte-identical mirrors

## What Could Improve
1. **npm-package mirrors diverge again** — `src/npm-package/mutation/` mirrors byte-identical but `src/npm-package/adapters/` directory doesn't exist (mirrors at `src/npm-package/adapter-common.sh` and `src/npm-package/hooks/adapter-common.sh`). Multiple mirror paths confusing.
2. **PitestRunner test expectation stale** — code-walkthrough fix changed `'./gradlew'` to `join(cwd, 'gradlew')` but test wasn't updated. Caught only at full test run (180s). Should have run tests after each code-walkthrough fix batch.
3. **C++ (Mull) deferral** — deferred to follow-up sprint; should track as explicit follow-up issue.
4. **No real-world Python/Go/Java project verification yet** — all testing is unit tests against mocks. Gate M Go/Java/Kotlin untested against actual mutation tools (gomutants not installed locally, PITest not installed).

## Lessons Learned
1. **Run tests after code-walkthrough fixes**, not just at end of REVIEW — the gradlew path fix broke 2 tests that could have been caught immediately
2. **Full-path vs relative-path** — `join(cwd, 'gradlew')` is correct (avoids PATH ambiguity from `./gradlew`); update test expectation to match
3. **Mirror sync needs CI check** — manual `cp` is error-prone; `scripts/copy-skills.sh` pattern should be extended to mutation runners
4. **Tool-availability graceful SKIP** — Go `gomutants` and Java PITest are NOT installed in this dev environment; Gate M will SKIP → correct behavior per project convention

## Retro Notes
- Go tool: `gomutants` (szhekpisov/gomutants) — NOT `go-mutesting` (different toolchain)
- Kotlin shares PITest runner with Java (JVM bytecode level) — correct architectural decision
- PITest timeout: 600s (10min vs Go's 2min) — appropriate for JVM cold-start
- Pre-push hard limits still apply: ≤20 files / ≤500 LOC per push
