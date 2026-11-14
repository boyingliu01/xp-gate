# GITHOOKS KNOWLEDGE BASE

**Generated:** 2026-11-04
**Commit:** eb2097b0
**Branch:** sprint/2026-11-03-02
**Version:** 0.38.3.0

## OVERVIEW
Git quality gates: pre-commit runs **12 numbered gates** (Gate 0–11) plus Gate 12 (File Hygiene, warning-only) via 13 language adapters; pre-push runs **8 gates**: Gate 10 (Build Integrity), Gate M (TS mutation), Gate M-Python, M-Go, M-Java, M-Kotlin (multi-lang mutation), Gate M2 (Mock Density, WARNING-only), Gate ML (Mock Layering), Gate UI (UI Sprint Gates), Gate MW (Code Walkthrough), and Gate S (Sprint Flow). Zero-tolerance policy per `QUALITY-GATES-CODE-OF-CONDUCT.md` — `--no-verify` strictly prohibited.

## STRUCTURE
```
githooks/
├── pre-commit                    # ~2084 lines: Gate 0 (Version) + Gates 1–9
├── pre-push                      # ~607 lines: Gate M / M2 / M3 + Delphi walkthrough validator
├── adapter-common.sh             # detect_project_lang(), route_to_adapter(), 3-tier resolution
├── adapters/                     # 13 language adapters + plugins/
│   ├── typescript.sh, python.sh, go.sh, java.sh, kotlin.sh
│   ├── cpp.sh, swift.sh, objectivec.sh, shell.sh, powershell.sh
│   ├── dart.sh, flutter.sh, iac.sh
│   │                             # NOTE: no standalone c.sh (cpp.sh handles both C and C++)
│   └── plugins/                  # 5 third-party extensions
│       ├── p3c-java/             # Alibaba P3C Java guidelines
│       ├── whalecloud-java/      # Whalecloud Java rules
│       ├── book299-20132-python/ # Python style rules
│       ├── book299-4081-c/       # C style rules
│       └── book299-4083-javascriptes5/  # ES5 JavaScript rules
├── QUALITY-GATES-CODE-OF-CONDUCT.md  # --no-verify strictly prohibited
├── TOOL-INSTALLATION-GUIDE.md
├── install.sh, verify.sh         # Project-local install + verification
└── __tests__/                    # BATS tests
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Pre-commit gates | pre-commit | Gate 0 + 1..9 (see GATES section below) |
| Language routing | adapter-common.sh | 3-tier: global `~/.config/xp-gate/adapters` → project `githooks/adapters/` → script dir |
| Adapters | adapters/ | 13 languages (no standalone C — cpp.sh handles both) |
| Plugin adapters | adapters/plugins/ | 5 third-party extensions |
| Pre-push gates | pre-push | Gate M (mutation), M2 (mock density), M3 (mock policy), + Delphi walkthrough |
| Code of Conduct | QUALITY-GATES-CODE-OF-CONDUCT.md | Zero-tolerance — `--no-verify` prohibited |
| Local install | install.sh | Per-project install of hooks + adapter infrastructure |
| Verify install | verify.sh | Sanity check installation |
| Tests | __tests__/ | BATS tests for gate routing + adapters |

## GATES

### Pre-commit (12 numbered gates)

| Gate | Name | Tool / Source | Block on |
|------|------|---------------|----------|
| 0 | Version Consistency | `../src/architecture/version-parser.ts` + repo `VERSION` | VERSION ≠ any package.json |
| 1 | Code Quality | Adapter `lint` (ESLint / Ruff / govet / clang-tidy / ...) | Any lint error |
| 2 | Duplicate Code | jscpd (`jscpd.conf.json`) | >5% similarity |
| 3 | Cyclomatic Complexity | lizard | CCN >5 warn, >10 block |
| 4 | Principles | `../src/principles/index.ts` (14 rules × 9 langs) | Any error/warning per `.principlesrc` |
| 5 | Tests + Coverage | Adapter `test` + coverage | Test fail; coverage <80% |
| 6 | Architecture + Boy Scout | `.archlint.yaml` + `../src/principles/boy-scout.ts` | New warnings on modified files |
| 7 | IaC Security | checkov / hadolint / kube-score / tflint | High-severity finding |
| 8 | Secret Scanning | gitleaks (`.gitleaks.toml`) | Any leaked secret |
| 9 | Build Integrity | tsc + npm pack + import check | Build/compilation failure |
| 10 | SAST Security | semgrep ruleset | High-severity finding |
| 11 | Sprint Flow | sprint-gate.sh | Sprint compliance violation |
| 12 | File Hygiene | gate-12-file-hygiene.sh | WARNING-only (conflict markers, YAML/JSON syntax block) |

> The README/docs/CAPABILITIES.md "6 Gates" framing is a conceptual grouping (CodeQ, Complexity, Principles, Tests, Architecture, Security) over these 10 script-level gates. See root `AGENTS.md` → "Known Drift" #1.

### Pre-push (8 gates)

| Gate | Name | Source | Block on |
|------|------|--------|----------|
| 10 | Build Integrity | tsc + npm pack | Build/compilation failure |
| M | Incremental Mutation (TS) | `../src/mutation/gate-m.ts` (Stryker, `stryker.prepush.conf.json`) | Mutation score < threshold |
| M-Python | Incremental Mutation (Python) | inline in pre-push | Mutation score < threshold |
| M-Go | Incremental Mutation (Go) | inline in pre-push | Mutation score < threshold |
| M-Java | Incremental Mutation (Java) | inline in pre-push | Mutation score < threshold |
| M-Kotlin | Incremental Mutation (Kotlin) | inline in pre-push | Mutation score < threshold |
| M2 | Mock Density | inline in `pre-push` (keyword scan: vi.mock, jest.mock, etc.) | WARNING only (>30% mock density without `@mock-justified`) |
| ML | Mock Layering Policy | `../src/mock-policy/gate-m3.ts` | Per-layer mock policy violation when `severity=error` |
| UI | UI Sprint Quality Gates | inline in pre-push | UI regression or missing UI review |
| MW | Code-walkthrough validator | reads `.code-walkthrough-result.json` | File missing, OR commit hash stale vs HEAD |
| S | Sprint Flow Enforcement | sprint-gate.sh | specification.yaml compliance |

Code-walkthrough has no hard file-count or LOC threshold. Large diffs must be reviewed completely or split by user choice; size-based bypass is not permitted. Code-walkthrough is skipped on main/master pushes by design. All pre-push runs write a JSON journal under `.xp-gate/reports/pre-push/<UTC-timestamp>.json`.

## CONVENTIONS
- **3-tier adapter resolution**: `~/.config/xp-gate/adapters/<lang>.sh` (global) → `<project>/githooks/adapters/<lang>.sh` (project) → script dir (fallback).
- **Tool unavailable → SKIP, not BLOCK** — *except Gate 8*: since #499 secret scanning is **fail-closed** — gitleaks missing or exiting non-0/1 BLOCKs the commit (a security gate that cannot run must not report success). CI installs gitleaks for the first-commit job accordingly. Adapter degrades other gates to SKIP when the underlying tool isn't installed; block fires only when the tool exists and the check fails.
- **Code-walkthrough scope**: no hard file-count or LOC threshold; large diffs require complete review or user-directed splitting, never a size-based bypass.
- **Code-walkthrough skipped on main/master.** Gate M, M2, M3 still run.
- **Boy Scout Rule (Gate 6)**: new files zero-tolerance; modified files cannot increase warnings; untouched files unchecked.
- **Adapter plugins** under `adapters/plugins/` extend the base language adapters (P3C/whalecloud for Java, book299 for Python/C/ES5 JS). Opt-in per project.
- **Project-level coverage exclusions**: a project may ship `.xp-gate-powershell-coverage-ignore` (one glob per line, `#` comments allowed) to exclude scripts that cannot be exercised by Pester (e.g. bootstrap scripts whose `Main` ends in `exit`); the PowerShell adapter drops matching files from coverage accounting instead of counting them as 0%. Python coverage thresholds come from `pyproject.toml [tool.coverage.report] fail_under` — the adapter never hardcodes a threshold.
- **Gate 10 SAST verdict comes from semgrep's JSON, not its exit code (#518)**: without `--error`, semgrep exits 0 even with ERROR-severity findings, and its own severity scale (ERROR/WARNING/INFO) never intersects the old CRITICAL/HIGH red-flag vocabulary — the gate used to print PASS on a textbook command-injection finding. The verdict is now parsed from `results[].extra.severity` with a union vocabulary: blocking = everything OUTSIDE the warnings-only list (WARNING|INFO|MEDIUM|LOW) — i.e. ERROR/CRITICAL/HIGH **and any unknown or missing tier fail closed to BLOCK**; warnings-only = WARNING|INFO|MEDIUM|LOW. stdout/stderr are captured separately (the old `2>&1` merge poisoned the JSON). `--error` must NOT be added: its exit-code mapping has drifted across semgrep versions/platforms and the JSON verdict needs nothing from it — keeping it off also leaves failure exit codes unambiguous for the #475 diagnostics path. node is a hard dependency of the verdict and is checked BEFORE the semgrep run (missing node = SKIP with an install hint, not a silent net-loss). Unparseable output, missing verdict fields, or a zero-results run with scan errors/nonzero exit all fail closed to SKIP (never PASS). The same semantics are implemented in the TS CLI gate (`src/gates/gate-9.ts`, dispatched as `xp-gate gate sast`); the legacy `gate-9*.sh` fallback copies are tracked in a follow-up issue. Pinned by `__tests__/gate-10-verdict.test.bats` and `src/gates/__tests__/gate-9.test.ts`.
- **Python mypy scope is repo-declared (#513, generalizing #501)**: `adapters/python.sh` uses `.xp-gate-mypy-scope` at the repo root when present (one directory per line, `#` comments allowed — full-line or inline); otherwise existence-guarded `src/` + `scripts/`. Every target (declared or default) must exist AND contain at least one `.py` file — targets failing the guard are WARNed and skipped, so a typo'd or .py-less declaration degrades to SKIP instead of false-BLOCKing. An empty or fully-unusable declaration also SKIPs (with a distinct WARNING), never a silent pass-through. A repo declaring no type surface SKIPs with a notice pointing to the declaration file instead of false-BLOCKing every `.py` commit. mypy is invoked **per target** (matching the CI type job's per-directory runs — a merged `mypy src scripts` call reports "Duplicate module" for same-named modules and false-BLOCKs). Never a bare `mypy .`. Pinned by `__tests__/adapter-mypy-pester-scope.test.bats`.
- **PROJECT_SUBDIR derivation is root-aware** (#515, R2 delphi-walkthrough): nested project markers only locate a subdir when the repo ROOT itself declares no project. The root short-circuit marker set is the FULL `_detect_subdir` set (10 markers: tsconfig.json / package.json / pyproject.toml / setup.py / go.mod / pubspec.yaml / pom.xml / build.gradle / build.gradle.kts / CMakeLists.txt) — the two lists must not drift. One exception, checked FIRST (a root tsconfig.json often coexists with it): a root `package.json` carrying a `"workspaces":` key is a JS monorepo, not a single project, so derivation keeps running there. Known limitation (#527, pinned in tests): Gradle multi-module, CMake subdirectory layouts and pnpm (`pnpm-workspace.yaml`) / Lerna (`lerna.json`) workspaces are not disambiguated from single projects — the root marker wins. With a root marker present, a nested marker that is merely a module file must not hijack the cwd — Gates 1-9 would run in the wrong directory and false-BLOCK on root-relative paths. Pinned by `__tests__/subdir-root-shortcircuit.test.bats`.
- **No CLI invocation in pre-push hook for Delphi.** The hook is a validator only — it reads `.code-walkthrough-result.json`; the actual review must run via the skill before push.
- **Adapters are duplicated** into `src/npm-package/adapters/`. Source of truth = here; resync via build scripts.

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT use `--no-verify` to bypass any gate. Process violation per `QUALITY-GATES-CODE-OF-CONDUCT.md`.
- Do NOT use change size as authorization to bypass code-walkthrough; review large diffs completely or split them before review.
- Do NOT hardcode tool paths in an adapter — use the routing in `adapter-common.sh`.
- Do NOT delete or rename `.code-walkthrough-result.json` before push; the validator will block.
- Do NOT add a new gate without adding both a script-level Gate N row AND updating root `AGENTS.md` + `README.md`.
- Do NOT edit adapters here without resyncing `src/npm-package/adapters/`. Source-of-truth is this directory.

## UNIQUE STYLES
- **The ordered gate chain (#798).** `pre-commit` is now a PREAMBLE, one driver
  call, and an EPILOGUE. Gate bodies live in `gate-entries/gate-<KEY>-entry.sh`
  (one file per gate, each wrapping its body in `gate_<KEY>_run()`), and their
  ORDER is data: `XP_GATE_ORDER` in `gate-driver.sh`.
  - **To reorder gates, edit `XP_GATE_ORDER`.** Do not move code. Ordering used
    to BE the physical order of 16 inline blocks in a 6341-line file, and an
    attempt to reorder also moved the epilogue — after which every gate past it
    silently stopped running while `bash -n`, a line count and five ordering
    tests all passed. Gate 5a stopped blocking commits and only a behavioural
    fingerprint caught it (`scripts/record-hook-behaviour.cjs`).
  - **`gate_enabled()`/`XP_GATE_ONLY_GATE`, report keys, doctor and
    gate-coverage all key off the gate NUMBER**, which is why the number is a
    label bound by `gate-registry.sh` and never a position in the list.
  - **Gate bodies return, they do not exit.** A top-level `exit N` inside a
    `gate_N_run()` body becomes `return N`; the driver turns a non-zero return
    into the hook's exit status, so the EXIT trap still fires on the same status.
    Sub-shell exits (`( ... )`, `$( ... )`) are deliberately left as `exit`.
  - **The report writer lives with Gate 13.** `generate_quality_report()` is
    defined in `gate-entries/gate-13-entry.sh` and called by the epilogue, which
    is why that file must stay loadable even when Gate 13 itself is disabled. It
    is registered as a TOP-LEVEL function, not nested inside `gate_13_run()`, so
    a skipped Gate 13 cannot leave the report writer undefined.
- **Pre-push is a thin validator** — heavy lifting (mutation, mock policy, Delphi) lives in `src/` modules invoked via `npx tsx`.
- **Graceful adapter degradation**: SKIP semantics keep the hook useful in mixed-language repos.
- **JSON journal**: every pre-push writes `.xp-gate/reports/pre-push/*.json` for audit / `xp-gate audit --tail`.
- **A gate must never wait on the network.** `run_tsx` falls back to `npx tsx`,
  which DOWNLOADS the package when it is absent locally. `record_gate_audit` ran
  once per gate through that fallback, so a repo without a local `tsx` spent its
  whole budget on the network (measured: 180 s per blocked commit in a fixture)
  and the gate-order work looked like it had made the hook slower. Audit calls
  now resolve `node_modules/.bin/tsx` only and skip the record when absent — a
  missing journal entry is recoverable, a frozen commit is not.

## COMMANDS
```bash
# Install per-project hooks + adapter infrastructure
bash githooks/install.sh

# Verify installation integrity
bash githooks/verify.sh

# Run BATS tests (the whole suite is ~1300 cases; run one file while iterating)
bash node_modules/bats/bin/bats githooks/__tests__/gate-5a-block.test.bats

# Run the suite the way CI does -- cost-balanced shards, see
# docs/plans/2026-11-12-ci-bats-runtime-optimization.md
node scripts/run-bats-ci.cjs --shard 1/4 --print-only   # what would run
node scripts/run-bats-ci.cjs --shard 1/4                # on Windows: serial (see above)

# Check / repair drift between this directory and the INSTALLED hooks
xp-gate doctor                # reports hook drift + which copy is in charge
xp-gate doctor --sync-hooks   # copy githooks/* over the installed copy
```

## EFFECTIVE HOOKS — READ THIS BEFORE EDITING A HOOK

This directory is the **source of truth in version control**, but it is **not
necessarily what executes**. When `core.hooksPath` is set (global install), git
runs the copy under `~/.config/xp-gate/hooks/` instead:

```
$ git config --get core.hooksPath
C:/Users/think/.config/xp-gate/hooks
```

Editing a hook here therefore has **no local effect** until you sync. This was
the whole of issue #451, and it is easy to misread as "my edit does nothing".

```bash
xp-gate doctor                # shows "Effective hooks:", the drift, and its direction
xp-gate doctor --sync-hooks   # make this directory effective, then commit as normal
```

`xp-gate doctor` reports drift only when the current project actually carries
hook files here (i.e. this repo, or a fork). Consumer projects get only
`githooks/adapters/` from `xp-gate init`, which is not a hook source of truth.

### The adapters drift the same way — and it hides behind a plausible story

`githooks/adapters/*.sh` are resolved through the same 3-tier chain, so a stale
`~/.config/xp-gate/adapters/<lang>.sh` **overrides this directory**. Diagnosis
symptom, measured 2026-11-13: the Kotlin adapter ran through a hook, reported
`❌ Gradle compilation failed` and nothing else, while `source adapters/kotlin.sh;
run_static_analysis` on the same tree printed two real `MagicNumber` findings.

The stale copy was 77 lines; the tracked one 128. It still had the old
`elif [ -n "$ktlint_out" ]` / `elif command -v detekt` shape, so a silent ktlint
(empty output, exit 0) consumed the branch and detekt — which worked — never ran.

**A wrong cross-boundary path makes this look like a product defect, and it was
diagnosed as one for several rounds.** The trap is specific and worth spelling
out: the probe ran under WSL, so `$HOME` was `/home/boyingliu01`, while the
"fix" copied with the Git Bash path `~/.config/...` → `C:\Users\think\.config\...`.
Both ended in `/xp-gate/adapters/kotlin.sh`; only one of them is read. `cp`
succeeded, the md5 stayed unchanged, and the probe kept reproducing "the bug".
Check the md5 of the file the process ACTUALLY reads before concluding anything:

```bash
bash -c 'md5sum "$HOME/.config/xp-gate/adapters/kotlin.sh" githooks/adapters/kotlin.sh'
```

Rule: an adapter is stale until proven otherwise; `md5sum` both copies and
compare against a known-good commit before believing a hook-vs-direct-call
difference. CI is unaffected (fresh checkout, no global copy), which is a useful
control — **if CI disagrees with local, suspect the local install first.**

### Never probe across environments — run everything on Windows

This repo is developed on Windows and **WSL is not part of the development loop**
(starting it costs ~12 GB of RAM for nothing, since every tool the gates need is
installed natively: node, python, lizard, semgrep, pytest, pytest-cov, detekt,
ktlint, jscpd, archlint, gitleaks, checkov, hadolint, kube-score, tflint, mutmut,
ruff, mypy, eslint, tsc, stryker).

Run BATS with the repo's own runner, natively:

```bash
bash node_modules/bats/bin/bats githooks/__tests__/<suite>.test.bats   # iterate
node scripts/run-bats-ci.cjs --shard 1/4                               # CI-shaped
```

The WSL round-trip above produced a *false* product-defect diagnosis (see the
adapter-drift note) because it changed `$HOME`, the interpreter, and the files
each environment could see — all at once, invisibly. When a probe and the real
environment differ, you are measuring the difference, not the product.

**Known limit, with a real reason:** `bats --jobs N` needs `flock` or `shlock`,
and Git for Windows ships neither, so parallel shards cannot run natively. The
runner detects this and falls back to serial with a warning instead of aborting
(`hasParallelRunner()` in `scripts/run-bats-ci.cjs`). Serial is fine for a single
suite; the full CI-shaped suite is what GitHub Actions is for.

Two real WSL dependencies remain, and neither is on the daily path: Gate M's
`mutmut` on native Windows (#410 — `wsl mutmut` is one branch of its probe) and
`lib/native-path.sh` path translation. Leave them alone; do not reintroduce WSL
as a general-purpose shell.

## NOTES
- See repo root `AGENTS.md` → "Known Drift" for the canonical list of doc-vs-reality gaps (gate count, C-adapter claim, etc).
- Pre-push reads `.code-walkthrough-result.json` and compares `commit_hash` to `git rev-parse HEAD`.
- Main-branch push: Gate M / M2 / M3 still execute; only the walkthrough validator is skipped.
- Mutation testing CI: `.github/workflows/mutation-test.yml` narrows `--mutate` to the files changed in the PR (full-suite runs exceed the 45-min budget).
