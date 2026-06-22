# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-22
**Commit:** 984d568
**Branch:** main
**Version:** 0.10.0.0

## OVERVIEW
XP-Gate — deterministic git quality gates + AI-driven multi-expert review (Delphi) + Sprint Flow pipeline + npm zero-install distribution + cross-platform plugin system (Claude Code / OpenCode / Qoder). Pre-commit runs **10 numbered gates (Gate 0–9)** at the script level, conceptually grouped as **6 categories** in user-facing docs (README, CAPABILITIES.md). Pre-push runs **3 mutation/mock gates (M, M2, M3) + Delphi code-walkthrough**. Implements 14 Clean Code/SOLID rules across 9 language adapters (TypeScript engine), 13 shell adapters (gate routing), Boy Scout Rule baseline enforcement, test-specification alignment, mock policy enforcement, and incremental mutation testing.

> **Doc-vs-script drift, intentional:** README/CAPABILITIES.md describe "6 Gates" as a conceptual grouping; the actual `githooks/pre-commit` script runs Gate 0–9. Tracked as a doc-alignment issue, not a bug.
>
> **v0.9.2**: Windows Git Bash compatibility — `detect_os_env()`, `head→sed` migration (46 changes), `[[ ]]→[ ]` POSIX conditionals (47 changes), winget install hints, Windows CI job. All 37 githooks `.sh` files are now `head`-free.

## STRUCTURE
```
./
├── src/
│   ├── npm-package/    # npm distribution v0.8.8 (@boyingliu01/xp-gate); 11+ CLI commands
│   │   ├── bin/xp-gate.js              # CLI entry: dispatches all subcommands
│   │   ├── adapters/                   # 13 shell adapters (mirror of githooks/adapters/ — tech debt)
│   │   ├── hooks/                      # pre-commit, pre-push, adapter-common.sh (shipped to user repos)
│   │   ├── lib/                        # init, install/update/uninstall-skill, doctor, migrate,
│   │   │                               # baseline, audit-log, gate-audit, rollback, ui-detector,
│   │   │                               # ui-review, download-skill, shared-paths, shared-utils
│   │   ├── skills/                     # 8 skills bundled at publish time (mirror of repo skills/)
│   │   ├── plugins/                    # claude-code/, opencode/, qoder/ bundled at publish time
│   │   └── scripts/sync-package-content.js  # prepack hook that copies skills+plugins in
│   ├── principles/     # 14 Clean Code/SOLID rules × 9 language adapters (Gate 4)
│   ├── architecture/   # version-parser.ts + __tests__/  (used by ARCH-001..014 + Gate 0)
│   ├── debugger/       # trace-collector.ts + summarizer.ts + types.ts (debug trace pipeline)
│   ├── mock-policy/    # Gate M3: scope scanner + mock decision engine + per-file validator
│   ├── mutation/       # Gate M (incremental mutation) + Gate M2 helpers (detect-ai-test) + baselines
│   └── rules/          # Shared rule index
├── plugins/            # Cross-platform plugin sources (v0.4.0+; rebuilt into src/npm-package/plugins/)
│   ├── claude-code/    # JSON manifest + bash hooks + bin wrapper; ships all 8 skills
│   ├── opencode/       # TS module with 3 tools (gate-check, gate-principles, gate-arch); ships all 8 skills
│   ├── qoder/          # 7 skills (expects npx xp-gate call for gate tooling; plugin.json exists)
│   └── shared/         # Cross-platform docs (when present)
├── githooks/           # Source-of-truth hook scripts (also bundled into npm package)
│   ├── pre-commit      # ~2084 lines: Gate 0 (Version Consistency) + Gates 1–9
│   ├── pre-push        # ~607 lines: Gate M + Gate M2 + Gate M3 + Delphi code-walkthrough
│   ├── adapter-common.sh  # detect_project_lang() + route_to_adapter() + 3-tier resolution
│   ├── adapters/       # 13 shell adapters: typescript, python, go, java, kotlin, cpp, swift,
│   │                   # objectivec, shell, powershell, dart, flutter, iac (NO standalone c.sh)
│   ├── adapters/plugins/  # 5 third-party extensions: p3c-java, whalecloud-java,
│   │                   # book299-{20132-python,4081-c,4083-javascriptes5}
│   ├── QUALITY-GATES-CODE-OF-CONDUCT.md
│   └── __tests__/      # BATS tests
├── skills/             # 8 canonical AI workflow skills (SKILL.md + references/ + templates/)
│   ├── sprint-flow/    # 11-phase pipeline (Phase -1, -0.5, 0..8); docs say "7-phase" (drift logged)
│   ├── delphi-review/  # ≥90% consensus (SKILL.md)
│   ├── test-specification-alignment/   # 2-phase (align modifiable → execute frozen)
│   ├── test-driven-development/        # NEW in 0.8.x; bundles testing-anti-patterns.md
│   ├── ralph-loop/                     # Phase 2 default build mode (REQ-level; 40-67% token savings)
│   ├── improve-codebase-architecture/  # Periodic architecture health check
│   ├── to-issues/                      # Vertical-slice issue splitter
│   └── admin-template-guidelines/
├── docs/               # 30+ design plans, incidents, retros, guides
├── scripts/            # build-plugin.sh, copy-skills.sh, sync-version.sh, test-plugins.sh,
│                       #   install-{hooks,skills,all}.sh, prepack.cjs
├── dashboard/          # Quality dashboard (serve.js + dashboard.js → localhost:3333)
├── .github/workflows/  # 5 CI pipelines: quality-gates (~948 LOC), npm-publish, cross-platform-ci,
│                       #   security-audit, mutation-test
├── ARCHITECTURE.md     # 818-line architecture reference
├── CAPABILITIES.md     # 298-line capability catalog
├── MANIFEST.md         # Machine-readable component manifest
├── architecture.yaml   # ARCH-001..014 rule definitions
├── specification.yaml  # Requirements (auto-generated from APPROVED design docs)
├── VERSION             # Single source of truth: 0.9.2.0 (MAJOR.MINOR.PATCH.MICRO)
├── .architecture-baseline.json  # ARCH baseline snapshot (~20 KB)
├── .archlint.yaml      # Architecture lint config
├── .mockpolicyrc       # Gate M3 mock policy config
├── .gitleaks.toml      # Gate 8 secret-scan rules
├── .checkov.yaml       # Gate 7 IaC scan config
├── hadolint.yaml       # Dockerfile lint config (IaC)
├── jscpd.conf.json     # Gate 2 duplicate-code config
├── .kube-score.yaml    # K8s manifest lint config (IaC)
├── .tflint.hcl         # Terraform lint config (IaC)
├── stryker.conf.json   # Gate M mutation config (full suite)
├── stryker.prepush.conf.json  # Gate M mutation config (pre-push slim)
├── .delphi-config.json # Delphi expert/model config (gitignored when contains keys)
└── .warnings-baseline.json    # Boy Scout Rule history
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| npm CLI dispatcher | src/npm-package/bin/xp-gate.js | 11+ subcommands |
| CLI implementations | src/npm-package/lib/ | init, install/update/uninstall-skill, doctor, migrate, uninstall, baseline, audit-log, gate-audit, rollback, ui-detector, ui-review, download-skill, shared-* |
| Claude Code plugin | plugins/claude-code/ | Manifest: .claude-plugin/plugin.json; hooks: hooks/hooks.json |
| OpenCode plugin | plugins/opencode/ | index.ts exposes gate-check, gate-principles, gate-arch |
| Qoder plugin | plugins/qoder/ | 7 skills (expects npx xp-gate for gate tooling) |
| Plugin builder | scripts/build-plugin.sh | --platform claude-code\|opencode\|qoder |
| Skill copy | scripts/copy-skills.sh | Preserves references/ and templates/ |
| Plugin tests | scripts/test-plugins.sh | 28 integration tests |
| Pre-commit gates | githooks/pre-commit | Gate 0–9 (see Gates section) |
| Pre-push gates | githooks/pre-push | Gate M, M2, M3 + Delphi walkthrough |
| Language adapters | githooks/adapters/ | 13 .sh files + 5 plugin extensions |
| Adapter routing | githooks/adapter-common.sh | 3-tier: global → project → script dir |
| Code of Conduct | githooks/QUALITY-GATES-CODE-OF-CONDUCT.md | --no-verify prohibited |
| Sprint Flow | skills/sprint-flow/SKILL.md | 11 phases; phase docs in references/phase-*.md |
| Delphi Review | skills/delphi-review/SKILL.md | Design + code-walkthrough modes; ≥90% consensus |
| Test Alignment | skills/test-specification-alignment/SKILL.md | Phase 1 modifiable / Phase 2 frozen |
| Principles Engine | src/principles/ | analyzer.ts + index.ts CLI; SARIF 2.1.0 output |
| Boy Scout Rule | src/principles/boy-scout.ts | Differential warning enforcement (Gate 6) |
| Architecture rules | src/architecture/version-parser.ts + architecture.yaml | ARCH-001..014 |
| Mutation Gate M | src/mutation/gate-m.ts | Incremental mutation on changed TS files |
| Mock Policy Gate M3 | src/mock-policy/gate-m3.ts | runGateM3() orchestrator |
| Debugger | src/debugger/ | trace-collector.ts + summarizer.ts |
| Version sync | scripts/sync-version.sh | VERSION → 4 package.json files (3-digit npm semver) |
| Quality Dashboard | dashboard/ | `npm run dashboard` → :3333 |
| CI Workflows | .github/workflows/ | 5 pipelines (~948 LOC quality-gates) |
| Design history | docs/plans/ | 30+ chronological design plans (YYYY-MM-DD-topic.md) |

## GATES (script-level, current as of f60b2e9)

### Pre-commit — `githooks/pre-commit`, ~2084 lines

| Gate | Name | Source / Tool | Block on |
|------|------|---------------|----------|
| 0 | Version Consistency | `src/architecture/version-parser.ts` + VERSION | VERSION ≠ package.json |
| 1 | Code Quality | Adapter `lint` (ESLint/Ruff/govet/...) | Any lint error |
| 2 | Duplicate Code | jscpd (`jscpd.conf.json`) | >5% similarity |
| 3 | Cyclomatic Complexity | lizard (CCN) | >5 warn, >10 block |
| 4 | Principles | `src/principles/index.ts` (14 rules × 9 langs) | Any error/warning per .principlesrc |
| 5 | Tests + Coverage | Adapter `test` + coverage | Test fail, coverage <80%. Gate 5a: new .ts/.tsx files BLOCK if no test |
| 6 | Architecture + Boy Scout | `.archlint.yaml` + `boy-scout.ts` | New warnings on modified files |
| 7 | IaC Security | checkov / hadolint / kube-score / tflint | High-severity finding |
| 8 | Secret Scanning | gitleaks (`.gitleaks.toml`) | Any leaked secret |
| 9 | Semgrep SAST | semgrep ruleset | High-severity finding |

> **Conceptual grouping in README/CAPABILITIES.md (still called "6 Gates"):**
> CodeQ (1+2+5) · Complexity (3) · Principles (4) · Tests (3+4+5) · Architecture (6) · plus newer Security gates (7+8+9). Gate 0 is treated as a pre-flight check.
> The two views are intentionally maintained until the README rewrite catches up.

### Pre-push — `githooks/pre-push`, ~607 lines

| Gate | Name | Source | Block on |
|------|------|--------|----------|
| M | Incremental Mutation | `src/mutation/gate-m.ts` (Stryker, prepush config) | Mutation score < threshold (TS only) |
| M2 | Mock Density Check | inline in pre-push | >30% mock density (Phase 1 WARNING) without `@mock-justified` |
| M3 | Mock Layering Policy | `src/mock-policy/gate-m3.ts` | Per-layer mock policy violation (severity=error) |
| Delphi | Code-walkthrough validator | `.code-walkthrough-result.json` | Missing or stale walkthrough vs HEAD commit |

> Pre-push hard limits: max **20 files** or **500 LOC** per push. Code-walkthrough skipped on main/master pushes (by design). All pre-push runs are journaled to `.xp-gate/reports/pre-push/*.json`.

## CLI (`src/npm-package/bin/xp-gate.js`)

Subcommands registered in 0.8.8.0 (verified against bin source):

| Command | Purpose |
|---------|---------|
| `xp-gate init` | Install hooks + adapter infrastructure into current project |
| `xp-gate setup-global` | Install adapters globally under `~/.config/xp-gate/` |
| `xp-gate uninstall` | Reverse of `init`; supports `--dry-run --force --local --global` |
| `xp-gate doctor` | Diagnose hook/adapter/env health; `--fix` for auto-repair |
| `xp-gate migrate` | Clean v0.4.x GitHub-Packages residue from `~/.npmrc` |
| `xp-gate baseline <create\|show\|reset\|diff>` | Manage lint baseline (Boy Scout track) |
| `xp-gate install-skill <name>` | Download + install a skill from GitHub |
| `xp-gate update-skill <name>` | Update an already-installed skill |
| `xp-gate uninstall-skill <name> --force` | Remove an installed skill |
| `xp-gate audit [--tail \| --stats \| record]` | Inspect / record gate audit log |
| `xp-gate ui-review` | Visual review for UI-bearing changes (delegates to ui-review.ts) |
| `xp-gate sprint-status [--json] [--watch] [--dir <path>]` | Show Sprint Flow progress (reads `.sprint-state/sprint-state.json`) |
| `xp-gate --version` | Print version (from VERSION file) |

> Older docs said "8 commands"; 0.8.8 grew to ≥11; 0.8.9 added `check`/`principles`/`arch` for parity with the OpenCode plugin (fixes #208). v0.8.16 added `sprint-status`, bringing the total to ≥16.

## CONVENTIONS
- **VERSION as single source of truth.** `scripts/sync-version.sh` propagates `MAJOR.MINOR.PATCH.MICRO` from `VERSION` into npm package.json files (3-digit) and plugin manifests. Root `package.json` uses 3-digit version. Never edit `package.json` versions by hand.
- **No `--no-verify` ever.** `githooks/QUALITY-GATES-CODE-OF-CONDUCT.md` makes hook bypass a process violation.
- **Tool missing → SKIP, not BLOCK.** When a language tool isn't installed, the adapter degrades the gate to SKIP instead of blocking the commit. Hard-block only fires when the tool exists and the check fails.
- **Boy Scout Rule (Gate 6).** New files: zero warnings. Modified files: warning count cannot increase vs `.warnings-baseline.json`. Untouched files: unchecked.
- **Pre-push hard limits.** Max 20 files or 500 LOC per push, enforced by `pre-push`.
- **Domestic-models-only for Delphi.** `.delphi-config.json` must use glm/kimi/minimax/qwen/deepseek; ≥2 different providers across the 3 experts. Anthropic/OpenAI/Google are forbidden.
- **Test annotations are mandatory.** Every test file must carry `@test REQ-XXX`, `@intent ...`, `@covers AC-XXX` JSDoc tags. Missing tags ⇒ test rejected.
- **TypeScript strict mode, always.** No `as any`, `@ts-ignore`, or `@ts-expect-error`. No empty `catch` blocks. No `print()` — use `logging`.
- **Adapters are duplicated** between `githooks/adapters/` and `src/npm-package/adapters/`. Edit `githooks/` first, then resync via build scripts. Known tech debt.

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT bypass any gate with `--no-verify`. Process violation.
- Do NOT edit `src/npm-package/adapters/` directly. Edit `githooks/adapters/` and resync.
- Do NOT edit a skill's `AGENTS.md` mirror under `plugins/*/skills/` or `src/npm-package/**/skills/` — those are byte-identical copies of `skills/<name>/AGENTS.md`. Edit the canonical file then re-copy.
- Do NOT hand-edit `package.json` versions. Run `scripts/sync-version.sh` against `VERSION`.
- Do NOT add runtime dependencies to `src/npm-package/` — it ships zero-install.
- Do NOT use Anthropic/OpenAI/Google models in `.delphi-config.json`. Domestic-only.
- Do NOT skip `delphi-review` in Sprint Flow Phase 1 — HARD-GATE blocks Phase 2.
- Do NOT terminate Delphi review before ≥90% consensus or 5 rounds (whichever first).
- Do NOT modify tests during Phase 2 of test-specification-alignment (freeze enforced).
- Do NOT push from main/master and expect code-walkthrough to run — by design it's skipped.
- Do NOT delete or rename `.code-walkthrough-result.json` before push.

## KNOWN DRIFT HISTORY

All 10 documented drift items (Gate count, pre-push gates, Delphi threshold, Sprint Flow phases, CLI count, qoder manifest, skill bundling, C adapter, CHANGELOG date, AGENTS.md staleness) were resolved in v0.8.9–v0.9.2. Run `/init-deep` whenever VERSION bumps a minor digit to prevent AGENTS.md mirror staleness.

