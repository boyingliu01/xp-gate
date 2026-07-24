# GITHOOKS KNOWLEDGE BASE

**Generated:** 2026-07-24
**Commit:** 8152a68
**Branch:** main
**Version:** 0.17.0.0

## OVERVIEW
Git quality gates: pre-commit runs **10 numbered gates** (Gate 0–9, conceptually grouped as "6 categories" in user-facing docs) via 13 language adapters; pre-push runs **Gate M + Gate M2 + Gate M3 + Delphi code-walkthrough validator**. Zero-tolerance policy per `QUALITY-GATES-CODE-OF-CONDUCT.md` — `--no-verify` strictly prohibited.

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

### Pre-commit (10 numbered gates)

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
| 9 | Semgrep SAST | semgrep ruleset | High-severity finding |

> The README/CAPABILITIES.md "6 Gates" framing is a conceptual grouping (CodeQ, Complexity, Principles, Tests, Architecture, Security) over these 10 script-level gates. See root `AGENTS.md` → "Known Drift" #1.

### Pre-push (Gate M / M2 / M3 + walkthrough)

| Gate | Name | Source | Block on |
|------|------|--------|----------|
| M | Incremental Mutation | `../src/mutation/gate-m.ts` (Stryker, `stryker.prepush.conf.json`) | Mutation score < threshold (TS only) |
| M2 | Mock Density Check | inline in `pre-push` (keyword scan: vi.mock, jest.mock, mockResolvedValue, MagicMock, `.patch(`, gomock, EXPECT, ...) | >30% mock density without `// @mock-justified: <reason>` (≥10 chars). Phase 1: WARNING only. Configurable via `.mockpolicyrc`. |
| M3 | Mock Layering Policy | `../src/mock-policy/gate-m3.ts` | Per-layer mock policy violation when `severity=error` |
| Delphi | Code-walkthrough validator | reads `.code-walkthrough-result.json` | File missing, OR commit hash stale vs HEAD |

Pre-push hard limits: max **20 files** or **500 LOC** per push. Code-walkthrough skipped on main/master pushes (by design). All pre-push runs write a JSON journal under `.xp-gate/reports/pre-push/<UTC-timestamp>.json`.

## CONVENTIONS
- **3-tier adapter resolution**: `~/.config/xp-gate/adapters/<lang>.sh` (global) → `<project>/githooks/adapters/<lang>.sh` (project) → script dir (fallback).
- **Tool unavailable → SKIP, not BLOCK.** Adapter degrades the gate to SKIP when the underlying tool isn't installed. Block fires only when the tool exists and the check fails.
- **Pre-push hard limits**: 20 files OR 500 LOC, whichever first.
- **Code-walkthrough skipped on main/master.** Gate M, M2, M3 still run.
- **Boy Scout Rule (Gate 6)**: new files zero-tolerance; modified files cannot increase warnings; untouched files unchecked.
- **Adapter plugins** under `adapters/plugins/` extend the base language adapters (P3C/whalecloud for Java, book299 for Python/C/ES5 JS). Opt-in per project.
- **No CLI invocation in pre-push hook for Delphi.** The hook is a validator only — it reads `.code-walkthrough-result.json`; the actual review must run via the skill before push.
- **Adapters are duplicated** into `src/npm-package/adapters/`. Source of truth = here; resync via build scripts.

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT use `--no-verify` to bypass any gate. Process violation per `QUALITY-GATES-CODE-OF-CONDUCT.md`.
- Do NOT push large commits that exceed the 20-file / 500-LOC limit.
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

