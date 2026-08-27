# GITHOOKS KNOWLEDGE BASE

**Generated:** 2026-08-24
**Commit:** a1a4683
**Branch:** dsh-plugin
**Version:** 0.19.0.0

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
- **Tool unavailable → SKIP, not BLOCK.** Adapter degrades the gate to SKIP when the underlying tool isn't installed. Block fires only when the tool exists and the check fails.
- **Code-walkthrough scope**: no hard file-count or LOC threshold; large diffs require complete review or user-directed splitting, never a size-based bypass.
- **Code-walkthrough skipped on main/master.** Gate M, M2, M3 still run.
- **Boy Scout Rule (Gate 6)**: new files zero-tolerance; modified files cannot increase warnings; untouched files unchecked.
- **Adapter plugins** under `adapters/plugins/` extend the base language adapters (P3C/whalecloud for Java, book299 for Python/C/ES5 JS). Opt-in per project.
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
- **Monolithic pre-commit** (~2084 lines) intentionally — single bash file keeps the trust boundary auditable.
- **Pre-push is a thin validator** — heavy lifting (mutation, mock policy, Delphi) lives in `src/` modules invoked via `npx tsx`.
- **Graceful adapter degradation**: SKIP semantics keep the hook useful in mixed-language repos.
- **JSON journal**: every pre-push writes `.xp-gate/reports/pre-push/*.json` for audit / `xp-gate audit --tail`.

## COMMANDS
```bash
# Install per-project hooks + adapter infrastructure
bash githooks/install.sh

# Verify installation integrity
bash githooks/verify.sh

# Run BATS tests
cd githooks/__tests__ && bats *.bats
```

## NOTES
- See repo root `AGENTS.md` → "Known Drift" for the canonical list of doc-vs-reality gaps (gate count, C-adapter claim, etc).
- Pre-push reads `.code-walkthrough-result.json` and compares `commit_hash` to `git rev-parse HEAD`.
- Main-branch push: Gate M / M2 / M3 still execute; only the walkthrough validator is skipped.
- Mutation testing CI: `.github/workflows/mutation-test.yml` (45-min timeout) runs the full suite outside this hook.
