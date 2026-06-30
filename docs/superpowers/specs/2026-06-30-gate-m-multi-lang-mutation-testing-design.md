# Gate M: Multi-Language Mutation Testing — Design Spec

**Issue**: #160
**Date**: 2026-06-30
**Status**: Design — Delphi Round 2 APPROVED (Expert C) + REQUEST_CHANGES (Expert A: minor clarifications) → clarifications applied
**Scope**: 4 languages (Python, Go, Java, Kotlin). C++ deferred to follow-up (Issue #TODO)

## 1. Problem Statement

Gate M (mutation testing) in the pre-push hook only supports TypeScript/JavaScript via Stryker. All other language projects silently skip mutation testing. The TypeScript-side infrastructure already supports multi-language routing via a `MutationRunner` interface with runner registry — but only StrykerRunner, MutmutRunner, and GoMutantRunner are registered, and the pre-push shell hook only wires TypeScript and (partially) Python.

## 2. Architecture (Two-Tier)

```
┌─ githooks/pre-push (shell — trust boundary) ──────────────────┐
│  Per-language Gate M blocks:                                   │
│    TypeScript (.ts/.tsx)  → npx tsx gate-m.ts --changed-files  │
│    Python     (.py)       → npx tsx gate-m.ts --changed-files  │
│    Go         (.go)       → npx tsx gate-m.ts --changed-files  │ [NEW]
│    Java       (.java)     → npx tsx gate-m.ts --changed-files  │ [NEW]
│    Kotlin     (.kt/.kts)  → npx tsx gate-m.ts --changed-files  │ [NEW]
│  Each block: filter by ext → detect tool → timeout run → exit  │
│  C++ (Mull) deferred to follow-up issue                        │ [DEFERRED]
└──────────────────────┬─────────────────────────────────────────┘
                       │
        ┌──────────────▼──────────────────────────┐
        │ src/mutation/gate-m.ts (orchestrator)    │
        │  filterSourceFiles() → groupByRunner()   │
        │  → resolveRunner(ext) → runAllRunners()  │
        │  UPDATED: per-runner timeout support     │ [FIXED R1.4]
        │  UPDATED: findTestFileForSource() for    │ [FIXED R1.5]
        │           Java/Kotlin test conventions   │
        └──────────────┬──────────────────────────┘
                       │
        ┌──────────────▼──────────────────────────────────┐
        │ src/mutation/runners/ (per-tool implementations)│
        │  StrykerRunner   (.ts, .tsx, .js, .jsx)         │
        │  MutmutRunner    (.py)                           │
        │  GoMutantRunner  (.go) — UPDATED to align with  │
        │                    shell gomutants detection   │ [FIXED R1.3]
        │  PitestRunner    (.java, .kt, .kts)       [NEW] │
        └─────────────────────────────────────────────────┘

## 3. Shell-Level Changes

### 3.1 adapter-common.sh — New Detection Functions

Two new `detect_*_mutation_testable()` functions:

```bash
# detect_go_mutation_testable()
# Checks: (1) gomutants CLI available, OR
#         (2) go.mod exists + gomutants binary in $GOPATH/bin
# NOTE: Uses "gomutants" (github.com/szhekpisov/gomutants), NOT "go-mutesting"
#       (zimmski/go-mutesting). Aligns with existing GoMutantRunner in TS layer.
detect_go_mutation_testable() {
  if command -v gomutants >/dev/null 2>&1; then return 0; fi
  if [ -f "go.mod" ]; then
    GOPATH_BIN="$(go env GOPATH 2>/dev/null)/bin"
    if [ -x "$GOPATH_BIN/gomutants" ]; then return 0; fi
  fi
  return 1
}

# detect_pitest_testable()
# Checks: (1) Maven (mvn) + pom.xml with pitest-maven plugin, OR
#         (2) Gradle (gradle/gradlew) + build.gradle(.kts) with pitest plugin
# Also required: Java source files (.java or .kt) exist in project
detect_pitest_testable() {
  if command -v mvn >/dev/null 2>&1 && grep -q "pitest-maven" pom.xml 2>/dev/null; then return 0; fi
  if command -v gradle >/dev/null 2>&1 || [ -f "./gradlew" ]; then
    if grep -q 'info.solidsoft.pitest' build.gradle 2>/dev/null; then return 0; fi
    if grep -q 'info.solidsoft.pitest' build.gradle.kts 2>/dev/null; then return 0; fi
  fi
  return 1
}
```

### 3.2 pre-push — New Gate M Sections

Following the existing Python pattern (lines 332-390), add two new sections:

**Gate M (Go)**: Collect `.go` files → `detect_go_mutation_testable` → run gate-m.ts with 120s timeout → handle exit codes (0=PASS, 1=BLOCK, 124=TIMEOUT)

**Gate M (Java)**: Collect `.java` files → `detect_pitest_testable` → run gate-m.ts with 600s timeout → handle exit codes

**Gate M (Kotlin)**: Collect `.kt/.kts` files → `detect_pitest_testable` (shares Java PITest tooling) → run gate-m.ts with 600s timeout → handle exit codes

Each section follows the identical structure as the existing Python section:
1. Filter changed files by extension
2. Skip if no files
3. Check tool availability (Skip if not available)
4. Build comma-separated file list
5. Find gate-m.ts script
6. Run with language-appropriate timeout (120s Go, 600s Java/Kotlin)
7. Handle exit code case (0/1/124)

**Timeout mechanism**: The shell invokes gate-m.ts once per language group, passing `--timeout-ms=<value>` to set per-runner timeout. Go uses `--timeout-ms=120000`, Java/Kotlin uses `--timeout-ms=600000`. This is architecturally simple — each `RunMutationOptions` carries the correct timeout for that language group — and requires no changes to the `runAllRunners()` function. Example for Java section:
```bash
timeout 600s npx tsx src/mutation/gate-m.ts --changed-files "$JAVA_FILES" --timeout-ms 600000
```

## 4. TypeScript Runner Changes

### 4.1 PitestRunner (NEW — Java + Kotlin)

```
extends: MutationRunner interface (name: "pitest", extensions: ["java", "kt", "kts"])
```

- **isAvailable()**: 
  - Detect Maven: `mvn` + `pom.xml` with `pitest-maven` plugin dependency
  - OR Detect Gradle: `gradle`/`gradlew` + `build.gradle(.kts)` with `info.solidsoft.pitest` plugin
  - Pure Kotlin projects (no `pom.xml`): detected via `build.gradle.kts` with pitest plugin
- **run()**: 
  - Maven: `mvn org.pitest:pitest-maven:mutationCoverage -DoutputFormats=JSON` (JSON output, not XML)
  - Gradle: `./gradlew pitest`
  - Parse JSON report for mutation scores
  - Normalize to `MutationRunResult` format
- **Timeout**: 600s (specified via per-runner timeout in gate-m.ts)

### 4.2 gate-m.ts — Orchestrator Updates

**4.2.1 Per-runner timeout support**:
The `runAllRunners()` function must be updated to support per-runner timeouts. Each runner's `RunMutationOptions` will receive the runner-specific timeout. Gate M CLI accepts `--timeout-ms=<ms>` with per-runner defaults if not specified.

**4.2.2 findTestFileForSource() — Java/Kotlin branches**:
Add detection logic for Java and Kotlin test file conventions:
- Java (Maven/Gradle): `src/main/java/X/Y/Foo.java` → `src/test/java/X/Y/FooTest.java`
- Kotlin (Maven/Gradle): `src/main/kotlin/X/Y/Foo.kt` → `src/test/kotlin/X/Y/FooTest.kt`
- Also check: `*Tests.java`, `*IT.java`, `*Test.kt`, `*Tests.kt`, `*Spec.kt`
- Multi-module projects: scan upward from source file for nearest `pom.xml`/`build.gradle`, then resolve `src/test/` relative to that module root
This enables `@test`, `@intent`, `@covers` annotation detection and `explicitThreshold` from test annotations.

**4.2.3 filterSourceFiles() — Java/Kotlin test file exclusion**:
Add patterns to exclude Java/Kotlin test files: `*Test.java`, `*Tests.java`, `*Spec.java`, `*IT.java`, `*Test.kt`, `*Tests.kt`, `*Spec.kt`. While PITest internally filters test classes, shell-level exclusion prevents unnecessary file passing.

### 4.3 Kotlin False-Positive Mitigation
PITest 1.7+ supports Kotlin but has known false-positive surviving mutants for:
- Inline functions (always appear as surviving mutants)
- Coroutine suspension points
- Default parameter values
- `when` expression exhaustiveness

Mitigation in `PitestRunner.run()`:
1. Pass `--excludedMutators` for known Kotlin-problematic operators (if user configures)
2. Document recommended PITest Kotlin plugin version (1.15+)
3. Accept 5% tolerance on mutation score for Kotlin-only modules
4. Emit warning (not BLOCK) when Kotlin-specific patterns are detected in surviving mutants

### 4.4 registerAllRunners() — Updated

```typescript
export function registerAllRunners(): void {
  registerRunner(new StrykerRunner());
  registerRunner(new MutmutRunner());
  registerRunner(new GoMutantRunner());
  registerRunner(new PitestRunner());   // NEW: Java + Kotlin via PITest
}
```

## 5. npm-package Mirror (Tech Debt Mitigation)

All files under `src/mutation/runners/` are duplicated to `src/npm-package/mutation/runners/`. New files must be created in BOTH locations simultaneously. Verification steps:
1. Create in `src/mutation/runners/` first (source of truth)
2. Copy byte-identical to `src/npm-package/mutation/runners/`
3. Verify: `diff -r src/mutation/ src/npm-package/mutation/` (should be empty)
4. The `registerAllRunners()` function must be identical in both `index.ts` files

## 6. Testing Strategy

| Test Type | Location | Scope |
|-----------|----------|-------|
| Unit: PitestRunner | `src/mutation/__tests__/pitest-runner.test.ts` | isAvailable, run, parse JSON output (with PITest JSON format) |
| Unit: gate-m routing | `src/mutation/__tests__/gate-m.test.ts` | resolveRunner returns PitestRunner for .java/.kt; per-runner timeout |
| Unit: test file detection | `src/mutation/__tests__/gate-m.test.ts` | findTestFileForSource returns correct paths for Java/Kotlin test conventions |
| Unit: Go runner alignment | `src/mutation/__tests__/go-mutant-runner.test.ts` | Verify isAvailable checks for `gomutants` (not `go-mutesting`) |
| BATS: pre-push detection | `githooks/__tests__/` | New detect_go_mutation_testable and detect_pitest_testable return correct codes |
| BATS: pre-push flow | `githooks/__tests__/` | Gate M sections SKIP/BLOCK correctly for Go, Java, Kotlin |
| Mirror verification | Manual | `diff -r src/mutation/ src/npm-package/mutation/` |
| Baseline init | New `src/mutation/init-baseline.ts` | Support `--lang java`, `--lang kotlin`, `--lang go` for initial baseline creation |

## 7. Design Decisions

| Decision | Rationale |
|----------|-----------|
| Per-language sections (not unified loop) | Pre-push is a trust boundary — separate sections are auditable and match existing Python pattern |
| Kotlin shares Java PITest runner | Both compile to JVM bytecode; a single `PitestRunner` with combined extension list handles both |
| PITest JSON output (not XML) | Use `-DoutputFormats=JSON` flag to keep parsing consistent with all other runners (JSON only) |
| Runner name convention: lowercase | "pitest" matches existing convention ("stryker", "mutmut", "gomutants") |
| Detection function named `detect_pitest_testable` | Covers both Java and Kotlin via PITest — tool-based naming, not language-based |
| Shell timeout matches runner requirements | 120s Go, 600s Java/Kotlin (specified per-language in pre-push, not hardcoded uniformly) |
| C++ (Mull) deferred to follow-up | Mull requires LLVM 14+ toolchain — near-universal SKIP in real-world projects. Deferred until demand materializes |
| Tool not installed → SKIP | Follows existing convention: adapters degrade gracefully, never block on missing tools |
| gate-m.ts orchestrator updates needed | Per-runner timeout support + findTestFileForSource Java/Kotlin branches required for integration |
| Baseline init for new languages | Extend `init-baseline.ts` with `--lang` flag to support Java/Kotlin/Go initial baselines |

## 8. Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| PITest slow (JVM startup + mutation) | 600s timeout; first-run caching prerequisite documented; SKIP on timeout with warning |
| PITest JSON output format varies by version | Use `-DoutputFormats=JSON` flag explicitly; runner validates JSON schema before parsing |
| Kotlin PITest false positives (inline, coroutines) | 5% tolerance on mutation score for Kotlin modules; recommended PITest 1.15+ with Kotlin plugin; documented exclusion list |
| Shell/TS Go tool mismatch (go-mutesting vs gomutants) | Aligned: both shell detection and GoMutantRunner use `gomutants` (szhekpisov/gomutants) |
| npm-package mirror drift | Both locations created simultaneously; diff verification in testing strategy |
| Pre-push file count limit (20 files) | Mutation testing counts toward limit; gate-m.ts per-runner batching |
| Pure Kotlin project not detected | `detect_pitest_testable` checks for `build.gradle.kts` with `info.solidsoft.pitest` plugin — covers Kotlin-only projects |
| Per-runner timeout not supported in gate-m.ts | gate-m.ts receives `--timeout-ms=<ms>` per invocation from shell; shell specifies language-appropriate timeout |

## 9. Revision History

| Round | Date | Verdict | Changes |
|-------|------|---------|---------|
| Round 1 | 2026-06-30 | REQUEST_CHANGES | Initial design submitted |
| Round 2 | 2026-06-30 | APPROVED (C) + REQUEST_CHANGES (A: clarifications) | Removed C++/Mull (deferred); Fixed Go tool name to `gomutants`; Changed PITest output to JSON via `-DoutputFormats=JSON`; Added per-runner timeout support; Added findTestFileForSource Java/Kotlin branches; Added Kotlin false-positive mitigation; Renamed detection function to `detect_pitest_testable`; Added baseline init plan; Fixed Gradle detection grep precision; Lowered PitestRunner name to "pitest" |
| Round 2a | 2026-06-30 | Clarifications applied | Documented timeout passthrough mechanism (`--timeout-ms` per shell invocation); Added explicit Java/Kotlin test file patterns for findTestFileForSource(); Added filterSourceFiles() Java/Kotlin exclusion patterns; Specified Kotlin 5% tolerance implementation (multiply score × 1.05 in runner, cap at 100%) |

