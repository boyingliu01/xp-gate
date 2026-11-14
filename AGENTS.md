# PROJECT KNOWLEDGE BASE

**Generated:** 2026-11-04
**Commit:** eb2097b0
**Branch:** sprint/2026-11-03-02
**Version:** 0.38.2.0

## OVERVIEW
XP-Gate — deterministic git quality gates + AI-driven multi-expert review (Delphi) + Sprint Flow pipeline (6 phases: PREP, DESIGN, BUILD, VERIFY, SHIP, CLOSE) + npm zero-install distribution + cross-platform plugin system (Claude Code / OpenCode / Qoder). Pre-commit runs **12 numbered gates (Gate 0–11) plus Gate 12 (File Hygiene, warning-only)**. Pre-push runs **8 gates: Gate 10 (Build Integrity), Gate M/M-Python/M-Go/M-Java/M-Kotlin (Mutation), Gate M2 (Mock Density, WARNING), Gate ML (Mock Layering), Gate UI (UI Sprint Gates), Gate MW (Code Walkthrough), and Gate S (Sprint Flow)**. Implements 14 Clean Code/SOLID rules across 9 language adapters (TypeScript engine), 13 shell adapters (gate routing), Boy Scout Rule baseline enforcement, test-specification alignment, mock policy enforcement, and incremental mutation testing.

> **Doc-vs-script drift resolved in v0.18.2:** Gate counts in docs, script comments, and AGENTS.md files are now consistent: pre-commit = 12 numbered gates (0–11 + 12 file hygiene warning-only), pre-push = 8 gates.
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
│   │   │                               # ui-review, shared-paths, shared-utils
│   │   ├── skills/                     # 12 skills bundled at publish time (mirror of repo skills/)
│   │   ├── plugins/                    # claude-code/, opencode/, qoder/ bundled at publish time
│   │   └── scripts/sync-package-content.js  # prepack hook that copies skills+plugins in
│   ├── principles/     # 14 Clean Code/SOLID rules × 9 language adapters (Gate 4)
│   ├── architecture/   # version-parser.ts + __tests__/  (Gate 0 only; ARCH-001..014 NOT implemented)
│   ├── debugger/       # trace-collector.ts + summarizer.ts + types.ts (debug trace pipeline)
│   ├── mock-policy/    # Gate M3: scope scanner + mock decision engine + per-file validator
│   ├── mutation/       # Gate M (incremental mutation) + Gate M2 helpers (detect-ai-test) + baselines
│   └── rules/          # Shared rule index
├── plugins/            # Cross-platform plugin sources (v0.4.0+; rebuilt into src/npm-package/plugins/)
│   ├── claude-code/    # JSON manifest + bash hooks + bin wrapper; ships all 12 skills
│   ├── opencode/       # TS module with 3 tools (gate-check, gate-principles, gate-arch); ships all 12 skills
│   ├── qoder/          # 8 skills (expects npx xp-gate call for gate tooling; plugin.json exists)
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
├── skills/             # 12 canonical AI workflow skills (SKILL.md + references/ + templates/)
│   ├── sprint-flow/    # 6-phase pipeline (Phase 1-6: PREP, DESIGN, BUILD, VERIFY, SHIP, CLOSE); docs say "6 阶段流水线"
│   ├── delphi-review/  # ≥90% consensus; 3 modes (design, code-walkthrough, requirements) (SKILL.md)
│   ├── test-specification-alignment/   # 2-phase (align modifiable → execute frozen)
│   ├── test-driven-development/        # NEW in 0.8.x; bundles testing-anti-patterns.md
│   ├── ralph-loop/                     # Phase 2 default build mode (REQ-level; 40-67% token savings)
│   ├── improve-codebase-architecture/  # Periodic architecture health check
│   ├── to-issues/                      # Vertical-slice issue splitter
│   ├── admin-template-guidelines/
│   ├── grill-with-docs/                # NEW in 0.18.0 (Matt Pocock); Phase 2 THINK main, brainstorming replacement
│   ├── batch-grill-me/                 # NEW in 0.18.0 (Matt Pocock); Phase 2 batch decisions, autoplan replacement
│   ├── grilling/                       # NEW in 0.18.0 (Matt Pocock); grill engine, dependency of grill-with-docs
│   └── domain-modeling/                # NEW in 0.18.0 (Matt Pocock); CONTEXT.md/ADR maintenance, with templates
├── docs/               # 30+ design plans, incidents, retros, guides + ARCHITECTURE.md, CAPABILITIES.md, MANIFEST.md
├── scripts/            # build-plugin.sh, copy-skills.sh, sync-version.cjs, test-plugins.mjs,
│                       #   install-{hooks,skills,all}.sh, prepack.cjs
├── dashboard/          # Quality dashboard (serve.js + dashboard.js → localhost:3333)
├── .github/workflows/  # 5 CI pipelines: quality-gates (~948 LOC), npm-publish, cross-platform-ci,
│                       #   security-audit, mutation-test
├── architecture.yaml   # ARCH-001..014 rule definitions (NOT ENFORCED — see #687)
├── specification.yaml  # Requirements (auto-generated from APPROVED design docs)
├── VERSION             # Single source of truth: 0.18.0.0 (MAJOR.MINOR.PATCH.MICRO)
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
| CLI implementations | src/npm-package/lib/ | init, install/update/uninstall-skill, doctor, migrate, uninstall, baseline, audit-log, gate-audit, rollback, ui-detector, ui-review, shared-* |
| Claude Code plugin | plugins/claude-code/ | Manifest: .claude-plugin/plugin.json; hooks: hooks/hooks.json |
| OpenCode plugin | plugins/opencode/ | index.ts exposes gate-check, gate-principles, gate-arch |
| Qoder plugin | plugins/qoder/ | 7 skills + 3 Delphi agents (auto-deployed by `xp-gate init` on Qoder platform) |
| Plugin builder | scripts/build-plugin.sh | --platform claude-code\|opencode\|qoder |
| Skill copy | scripts/copy-skills.sh | Preserves references/ and templates/ |
| Plugin tests | scripts/test-plugins.mjs | `npm run test:plugins` |
| Pre-commit gates | githooks/pre-commit | Gate 0–9 (see Gates section) |
| Pre-push gates | githooks/pre-push | Gate M, M2, M3 + Delphi walkthrough |
| Language adapters | githooks/adapters/ | 13 .sh files + 5 plugin extensions |
| Adapter routing | githooks/adapter-common.sh | 3-tier: global → project → script dir |
| Code of Conduct | githooks/QUALITY-GATES-CODE-OF-CONDUCT.md | --no-verify prohibited |
| Sprint Flow | skills/sprint-flow/SKILL.md | 6 phases; Phase 2 DESIGN: grill-with-docs → R1 requirements → batch-grill-me → R2 delphi-review; phase docs in references/phase-*.md |
| Delphi Review | skills/delphi-review/SKILL.md | 3 modes: design + code-walkthrough + requirements; ≥90% consensus |
| Test Alignment | skills/test-specification-alignment/SKILL.md | Phase 1 modifiable / Phase 2 frozen |
| Principles Engine | src/principles/ | analyzer.ts + index.ts CLI; SARIF 2.1.0 output |
| Boy Scout Rule | src/principles/boy-scout.ts | Differential warning enforcement (Gate 6) |
| Architecture rules | `src/architecture/version-parser.ts` (Gate 0 only) + `architecture.yaml` (**NOT ENFORCED** — see #687) | ARCH-001..014 是规划编号，当前无实现 |
| Mutation Gate M | src/mutation/gate-m.ts | Incremental mutation on changed TS files |
| Mock Policy Gate M3 | src/mock-policy/gate-m3.ts | runGateM3() orchestrator |
| Debugger | src/debugger/ | trace-collector.ts + summarizer.ts |
| Version sync | scripts/sync-version.cjs | VERSION → 4 package.json files (3-digit npm semver) |
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
| 9 | Build Integrity | tsc + npm pack + import check | Build/compilation failure |
| 10 | SAST Security | semgrep (`githooks/gate-10.sh`) | High-severity finding |
| 11 | Sprint Flow | `sprint-gate.sh` | Sprint compliance violation |
| 12 | File Hygiene | `gate-12-file-hygiene.sh` | WARNING only (conflict markers) |
| 13 | Compiler Strictness | `gate-13-compiler-strictness.sh` | Warnings under the strict tier |

> **Gate numbers are labels, not identities.** `githooks/gate-registry.sh` is the
> single source of truth binding each gate's **name** to the **file that runs
> it**. Use the name in prose, commits, and tests; the number is positional only.
>
> This matters concretely: this table previously listed Gate 9 as "Semgrep SAST"
> while the hook ran Build Integrity. In #717 that inaccuracy sent a C# SAST fix
> into `githooks/gate-9.sh` — a file no hook sources — so the fix changed nothing
> while appearing to land. `githooks/__tests__/gate-registry.test.bats` now
> asserts this table against the registry, so the drift fails a test instead of
> misleading the next reader.

> **Conceptual grouping in README/docs/CAPABILITIES.md (still called "6 Gates"):**
> CodeQ (1+2+5) · Complexity (3) · Principles (4) · Tests (3+4+5) · Architecture (6) · plus newer Security gates (7+8+9). Gate 0 is treated as a pre-flight check.
> The two views are intentionally maintained until the README rewrite catches up.

### Pre-push — `githooks/pre-push`, ~1212 lines

| Gate | Name | Source | Block on |
|------|------|--------|----------|
| M | Incremental Mutation | `src/mutation/gate-m.ts` (Stryker, prepush config) | Mutation score < threshold (TS only) |
| M2 | Mock Density Check | inline in pre-push | >30% mock density (Phase 1 WARNING) without `@mock-justified` |
| ML (M3) | Mock Layering Policy | `src/mock-policy/gate-m3.ts` | Per-layer mock policy violation (severity=error) |
| UI | UI Sprint Quality Gates | inline in pre-push | UI regression or missing UI review for UI-bearing changes |
| MW (Delphi) | Code-walkthrough validator | `.code-walkthrough-result.json` | Missing or stale walkthrough vs HEAD commit |

> Pre-push size limits were intentionally removed for AI workflows. All pre-push runs are journaled to `.xp-gate/reports/pre-push/*.json`.
>
> **Three gates skip on main/master pushes (by design — pre-reviewed via PR):**
> - **Mock Layering (Gate ML)** — `pre-push` line 715–718: `SKIP — pushing to main/master`
> - **UI Sprint Quality Gates (Gate UI)** — `pre-push` line 786–788: `UI Gate skipped (pre-reviewed via PR)`
> - **Code Walkthrough (Gate MW)** — `pre-push` line 858–860: `MW walkthrough skipped`

## CLI (`src/npm-package/bin/xp-gate.js`)

Subcommands registered in 0.8.8.0 (verified against bin source):

| Command | Purpose |
|---------|---------|
| `xp-gate init` | Install hooks + adapter infrastructure into current project |
| `xp-gate setup-global` | Install adapters globally under `~/.config/xp-gate/` |
| `xp-gate uninstall` | Reverse of `init`; supports `--dry-run --force --local --global` |
| `xp-gate doctor [--brief]` | Diagnose hook/adapter/env health; `--brief` dumps every common environment fact in one read-only pass (hooks/language/adapters/coverage/gate state, #653) — answers ~90% of exploratory probes in one round trip instead of many, and refuses to combine with `--fix`/`--sync-hooks`/`--install-tools`/`--force`; `--fix` for auto-repair; `--sync-hooks` copies repo `githooks/` over the installed copy and reports which hooks actually execute (#451) |
| `xp-gate migrate` | Clean v0.4.x GitHub-Packages residue from `~/.npmrc` |
| `xp-gate baseline <create\|show\|reset\|diff>` | Manage lint baseline (Boy Scout track) |
| `xp-gate install-skill <name>` | Install a skill from the package bundle (skills/<name>/) |
| `xp-gate update-skill <name>` | Update an already-installed skill |
| `xp-gate uninstall-skill <name> --force` | Remove an installed skill |
| `xp-gate audit [--tail \| --stats \| record \| assertions]` | Inspect / record gate audit log; `audit assertions [--json]` lists pre-existing tautology / empty-catch debt across the repo (#668) — Gate 5d only inspects diff files, so this is the batch work queue, and it always exits 0 |
| `xp-gate gate-rules [--json]` | The gate limits that can block a commit, generated from `.principlesrc` / `jscpd.conf.json` / the hook itself, each with an evidence pointer (#652). Generated rather than hand-copied: a checklist that drifts from its config teaches the wrong rule |
| `xp-gate ui-review` | Visual review for UI-bearing changes (delegates to ui-review.ts) |
| `xp-gate sprint-status [--json] [--watch] [--dir <path>] [--rework-check]` | Show Sprint Flow progress (reads `.sprint-state/sprint-state.json`); `--rework-check` calculates rework rate by counting fix commits after sprint completion (#369) |
| `xp-gate retro [--days N] [--all] [--json] [--sprint <id>]` | Generate engineering retrospective report (activity summary, rework rate trends, evidence skip exposure, quality trends) (#369) |
| `.flaky-quarantine.yaml` | Flaky-test quarantine ledger (#603). Every entry requires `owner` and `expiry`; `xp-gate doctor` warns on expired entries, and an entry with no expiry counts as already expired. `critical_path: true` is reported even before expiry. `xp-gate retro` prints first-pass rate, flaky recoveries and quarantine violations — and reports **NOT MEASURABLE** rather than 0% when the journal holds no re-run records |
| `xp-gate gate-coverage [--json] [--debt] [--strict] [--branch <name>]` | One view of compliance against every gate with FOUR states — PASS / **DEBT** / **SKIP** / **FAIL**. SKIP always carries a reason (`hook-only` / `not-applicable`) so a gate that never ran can never be read as green; DEBT is quantified with an evidence path (e.g. `136 warnings / 14 files` → `.warnings-baseline.json`). Marks the report **STALE** when the artifact's `commit` differs from HEAD rather than presenting another commit's results as current. Exit 0 unless a gate FAILed; `--strict` also fails on DEBT (#636) |
| `xp-gate rework [--top N] [--dir <path>] [--json]` | Rework report from the gate journal: first-pass rate (**NOT MEASURABLE** rather than 100% when the journal holds no failures), rounds before a landing (median/mean/worst), and top-N blocking reasons grouped by `failure_reason`. Excludes implausible `duration_ms` values whether or not they carry `duration_anomaly` (#651). Advisory only — always exits 0 |
| `xp-gate runtime-journal [--days N] [--json] [--sessions-dir <path>]` | Measures `AGENTS.md` §AGENT RUNTIME DISCIPLINE from the agent's own session journals: blocking `job_output` waits (and explicit `wait:true`), literal `sleep`, CI polling loops, oversized `timeout`, and calls/step batching (#712). **Advisory only — always exits 0**; reports **NOT MEASURABLE** rather than 0% when no journal is found. This is the only trustworthy source for "has the rule taken effect" |
| `xp-gate crap [--top N] [--threshold N] [--json] [--paths <p...>] [--include-mirrors]` | Rank functions by CRAP = CCN² × (1 − coverage) + CCN, worst first (#404). **Advisory only — always exits 0.** Needs `coverage/coverage-final.json`; functions whose file no test ever loaded are counted as `unmeasured`, never scored as 0% or 100% |
| `xp-gate sync-mirrors [--write] [--json]` | Drift report + repair for every canonical ↔ mirror pair (`githooks/adapters`, `githooks/lib`, `src/principles`, `src/build-integrity`, `skills`), (#713). **Dry-run unless `--write`** — a mis-declared pair silently mass-overwrites, so writing is opt-in. Compares the *tracked* file set, so an untracked artefact such as `githooks/lib/__pycache__/` is never read as drift; a tracked-but-deleted file still counts, which is what makes repair possible |
| `xp-gate --version` | Print version (from VERSION file) |

> Older docs said "8 commands"; 0.8.8 grew to ≥11; 0.8.9 added `check`/`principles`/`arch` for parity with the OpenCode plugin (fixes #208). v0.8.16 added `sprint-status`, bringing the total to ≥16. v0.18.0 added `retro` and `sprint-status --rework-check` (#369). v0.30.2 added `crap` (#404).

## EVIDENCE VALIDATION FRAMEWORK (v0.18.0+)

Sprint phase transitions (`xp-gate phase-transition`) validate evidence artifacts before allowing progression. Enforcement strictness depends on the sprint's `evidence_schema_version`.

| Evidence file | Location | Purpose | Required at |
|---------------|----------|---------|-------------|
| `requirements-reviewed.json` | `.sprint-state/phase-outputs/` | R1 requirements review evidence (Delphi `--mode requirements`) | Phase 2 → 3 (DESIGN → BUILD) |
| `test-alignment-report.json` | `.sprint-state/phase-outputs/` | Phase 4 test-specification alignment evidence (HARD-GATE) | Phase 4 (VERIFY) |

**Enforcement by schema version:**
- `evidence_schema_version >= 2` (new sprints): missing/invalid evidence → **BLOCK** (ok=false)
- `evidence_schema_version` missing or `< 2` (legacy sprints): missing/invalid evidence → **WARNING** (ok=true; upgrade sprint to `evidence_schema_version: 2` to enforce)

**Escape hatch:** `--skip-evidence --reason "<text>"` bypasses evidence validation for emergencies (e.g. hotfix). The skip is **audit-logged** (`.xp-gate/audit.jsonl`) and surfaced in `xp-gate retro` as "evidence skip exposure". A reason is mandatory — `--skip-evidence` without `--reason` is rejected.

```
xp-gate phase-transition 4 completed --skip-evidence "Emergency hotfix"
```

## CONVENTIONS
- **VERSION as single source of truth.** `scripts/sync-version.cjs` propagates `MAJOR.MINOR.PATCH.MICRO` from `VERSION` into npm package.json files (3-digit) and plugin manifests. Root `package.json` uses 3-digit version. Never edit `package.json` versions by hand.
- **No `--no-verify` ever.** `githooks/QUALITY-GATES-CODE-OF-CONDUCT.md` makes hook bypass a process violation.
- **Tool missing → SKIP, not BLOCK — except Gate 8.** When a language tool isn't installed, the adapter degrades the gate to SKIP instead of blocking the commit. Hard-block only fires when the tool exists and the check fails. Gate 8 (secret scanning) is fail-closed since #499: gitleaks missing or crashing BLOCKs, because a security gate that cannot run must not report success.
- **Input short-circuit before tool probe.** A gate must first ask "is there anything here to check?" (cheap, from the change set / project files) and only then "is the tool installed?" (expensive). `gate-9` filters semgrep files before probing semgrep; `python-health` calls `hasPythonSignal()` before probing mypy/pytest/ruff/flake8/black. Measured 2026-11-09 on a no-input fixture: python-health 3802 ms → 1607 ms (−57.7%), gate-9 789 ms → 624 ms (−21.0%), both load-valid (12-round ABBA). Every short-circuit MUST ship with a "must NOT be short-circuited" test — a predicate written against the *project* instead of the *change set* silently turns "checked" into "checked nothing". See REQ-GATE-PROBE-SHORTCUT.
- **npx is never used to probe a tool by default.** `probeToolNpx` runs `npx --yes <tool> --version`, where `--yes` means "install it without asking" — i.e. answering "is semgrep installed?" could hit the registry, download a package, and execute it. It is now off unless `XP_GATE_NPX_PROBE=1` (accepts `1`/`true`/`yes`). PATH lookup and `~/.local/bin` are unchanged, so a normally-installed tool is still found. Set the variable in CI for projects that deliberately rely on npx-provided tooling.
- **Which language needs a test run is an ADAPTER declaration, never a language name (v0.38+, #798/#794).** An adapter whose `run_coverage()` already executes and validates the suite defines `coverage_runs_tests() { return 0; }`; the hook then runs the suite ONCE instead of twice. Declared today: csharp, go, java, kotlin, dart, swift (typescript and python already collected coverage inline). **The default is the safe side**: an adapter that does not declare runs the tests anyway, because double-running costs time while not running them costs verification. Do NOT add `if [ "$CURRENT_LANG" = "<name>" ]` to defer test execution — that pattern was hand-patched twice (#794) and can only ever cover languages someone remembers. Add the one-line declaration to the new adapter instead.
- **Duration fields come from ONE clock, and a contradiction is reported as null (#798).** Both hooks measure with the shared `githooks/lib/now-ms.sh` helper (node `Date.now()`, regex-validated, `date +%s` fallback). The old `/proc/uptime` fraction parser (`cut -c1-3`) turned `331154.04` into `33115404` — 10× small — and reported 21,754 ms for a run that measured 199,000 ms, which is why #798 sat unoptimised. **Never introduce a second millisecond clock**, and never fall back to `|| 0` when the measurement fails: `duration_ms` is omitted/null instead, and is rejected to null when it is smaller than the longest per-gate duration recorded inside the run ("宁可没有数，也不要有一个会让所有优化决策跑偏的数").
- **Per-gate durations are published in the run report as `gateTimings` (#798).** `record_gate_audit` fills a `gate_name → ms` table and `gate_timings_json` emits it once into `.xp-gate/reports/pre-commit/*.json`. A gate that never measured a duration is ABSENT from the object, never `0` — "instant" and "not measured" must not look alike when ordering decisions read this. Any future "reorder gates by cost" work reads this field instead of estimating.
- **Boy Scout Rule (Gate 6).** New files: zero warnings. Modified files: warning count cannot increase vs `.warnings-baseline.json`. Untouched files: unchecked.
- **Pre-push size limits removed.** File/LOC hard limits were intentionally removed for AI workflows; pre-push still enforces mutation, mock, and code-walkthrough gates.
- **Three-model Delphi policy.** `.delphi-config.json` must configure architecture, technical, and feasibility. All three must execute successfully with distinct trimmed requested model IDs. Provider, vendor, gateway, and model nationality are unrestricted; one provider and token plan are allowed. `provider: local` fallback cannot count.
- **Test annotations are mandatory.** Every test file must carry `@test REQ-XXX`, `@intent ...`, `@covers AC-XXX` JSDoc tags. Missing tags ⇒ test rejected.
- **TypeScript strict mode, always.** No `as any`, `@ts-ignore`, or `@ts-expect-error`. No empty `catch` blocks. No `print()` — use `logging`.
- **Adapters are duplicated** between `githooks/adapters/` and `src/npm-package/adapters/`. Edit `githooks/` first, then resync via build scripts. Known tech debt.
- **Root lockfile names only the canonical npm registry.** Every `"resolved"` in `package-lock.json` is `https://registry.npmjs.org` — no mirror, no non-default port, no credentials, no query string, no plain http. This is an *artifact-level* invariant: npm rewrites the fetch host to the machine's configured `registry` at download time by default (`replace-registry-host`), so pinning the lock removes the repository's dependency on a mirror, not each developer machine's. A mirror in a developer `~/.npmrc` re-contaminates one entry per added dependency (`.npmrc` `replace-registry-host` is a measured no-op against mirrors). Repair offline with `npm run normalize-lock` (rewrites resolved sources only), never by hand-editing. Guarded by `scripts/__tests__/package-lock-registry.test.cjs`; tradeoffs in `docs/plans/2026-09-30-package-lock-registry-normalization.md`.
- **TDD mandatory before implementation (v0.14.0+).** Every implementation change MUST follow RED → GREEN → REFACTOR. Before delegating any implementation work, verify a failing test exists. If no test exists, write one first and mark the todo as `[TDD-RED]`. Only delegate implementation AFTER the RED test is committed. See `skills/sprint-flow/references/phase-3-build.md` for the full TDD-GATE specification. ralph-loop creates tests as step 0 — this is the pre-ralph-loop check, not a replacement.
- **In-session verification after changes (v0.14.31+).** After every implementation change (file edit, refactor, new feature, bug fix), the Agent MUST: (1) run the relevant verification commands (`npm test`, `npx vitest run`, `npm run lint`, `npx tsc --noEmit`, or project-specific equivalents) and (2) record the verification result in a structured format that external tools (e.g. Better Loop Harness) can capture. Never claim a change is complete without running and recording verification. See `skills/sprint-flow/references/phase-3-build.md` §In-Session Verification for the full specification.

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT bypass any gate with `--no-verify`. Process violation.
- Do NOT edit `src/npm-package/adapters/` directly. Edit `githooks/adapters/` and resync.
- Do NOT edit `src/npm-package/plugins/*/src/` directly (#542). The canonical source is `plugins/<name>/src/`; the mirror is regenerated by prepack's sync (a mirror-only fix gets silently rolled back at the next publish — v0.27.3 shipped exactly that bug). `scripts/check-hook-mirror.sh` now diffs every `plugins/*/src ↔ src/npm-package/plugins/*/src` pair.
- Do NOT edit a skill's `AGENTS.md` mirror under `plugins/*/skills/` or `src/npm-package/**/skills/` — those are byte-identical copies of `skills/<name>/AGENTS.md`. Edit the canonical file then re-copy.
- Do NOT hand-edit `package.json` versions. Run `node scripts/sync-version.cjs` against `VERSION`.
- Do NOT add runtime dependencies to `src/npm-package/` — it ships zero-install.
- Do NOT bypass the three distinct executable model requirement. `cross_provider_required` is deprecated and ignored with a warning.
- Do NOT skip `R1 requirements review` or `R2 delphi-review` in Sprint Flow Phase 2 (DESIGN) — HARD-GATE blocks Phase 3 (BUILD).
- Do NOT terminate Delphi review before ≥90% consensus or 5 rounds (whichever first).
- Do NOT modify tests during Phase 2 of test-specification-alignment (freeze enforced).
- Do NOT push from main/master and expect Gate ML, Gate UI, or Gate MW to run — by design all three are skipped (pre-reviewed via PR).
- Do NOT delete or rename `.code-walkthrough-result.json` before push.
- Do NOT claim a change is complete without running verification commands and recording the result. Every file edit, refactor, or feature implementation MUST be followed by `npm test` (or equivalent) + `npm run lint` and the output recorded. Unverified changes are invisible to Better Loop Harness and break the change→validation traceability chain.

## KNOWN DRIFT HISTORY

All 10 documented drift items (Gate count, pre-push gates, Delphi threshold, Sprint Flow phases, CLI count, qoder manifest, skill bundling, C adapter, CHANGELOG date, AGENTS.md staleness) were resolved in v0.8.9–v0.9.2. Run `/init-deep` whenever VERSION bumps a minor digit to prevent AGENTS.md mirror staleness.


## AI CODING DISCIPLINE (Karpathy Principles)

**原则 3: Surgical Changes（外科手术式改动）**
- 只碰必须碰的代码。只清理自己制造的混乱。
- 编辑现有代码时，不"优化"相邻代码、注释或 formatting
- 不重构没坏的东西
- 匹配现有代码风格，即使 AI 更喜欢另一种
- 发现无关的死代码 → 提及但不要删除（除非用户明确要求）
- 自己的改动产生的 orphaned import/variable/function → 必须清理
- 判定标准: 每一行改动都应能直接追溯到用户的请求

**原则 4: Goal-Driven Execution（目标驱动执行）**
- 定义成功标准。循环直到验证。
- 把指令转化为可验证目标：
  - "加验证" → "写测试 → 让测试通过"
  - "修 bug" → "写复现测试 → 让测试通过"
  - "重构 X" → "确保重构前后测试都通过"
- 多步骤任务列出验证点
- 改完任何代码后必须运行测试确认无 regression

## AGENT RUNTIME DISCIPLINE — 工具调用效率（P2, 2026-10-30 诊断）

> 依据 `docs/plans/2026-10-30-dev-speed-diagnosis.md`：正确计入的 251.7 h 中，工具延迟占
> 146.0 h（58%），远高于模型延迟 105.7 h（42%）。三条规则直接压的是这块。

**规则 1 — 读/搜一律用原生工具，shell 只用于“执行”**
- 读文件用 `read`，按路径找文件用 `glob`，搜内容用 `grep`。**禁止** `cat`/`Get-Content`/
  `type`/`head`/`tail`/`sed -n`/`Select-String`/`findstr`/`grep`/`rg`/`Get-ChildItem`/
  `find`/`ls` 去读取或搜索内容——这些会各起一个 pwsh/bash 进程，单次往返 10–30 s，
  而原生工具是毫秒级且可并行。shell 只留给真正的执行（构建、测试、git、脚本）。
- 现状（2026-11-02 复测，最近 3 天）：纯读取/搜索的 shell 调用已从 32.7% 降到 ~0.2%。
  目标 <5%（已达成，保持）。

**规则 2 — 独立调用必须同一步并发**
- 任何 ≥2 个**互不依赖**的调用，必须放进同一个 assistant 消息里并发发出，不得一个一个发。
  工具契约已支持同一 block 内多个 `invoke`。串行只在有数据依赖时才允许。
- **判据：发下一条消息前自查「这一批里有没有 2 个调用互不依赖？有就并进去」。**
- 典型该并发的清单（这张表就是为了免去判断）：
  - 读多个已知路径的文件；`grep` + `glob` + `read` 组合摸底
  - 多个互不相干的 `git` 查询（`status` / `log` / `diff` / `config`）
  - 检查多个环境事实（版本、路径、端口、开关）
  - 写完后并行跑**互不依赖**的校验（`lint` ∥ `tsc` ∥ 定向测试）
  - 查多个不同目录/多个候选位置
- **不能并发的**：后一个调用的参数依赖前一个的输出（先 `rev-parse` 再 `git show <sha>`）；
  有写冲突的操作（同一文件、同一 git 索引）。
- 现状（2026-11-02 复测，最近 3 天）：calls/step=**1.086**，仅 **5.1%**（283/5528）
  的步骤做到批量。目标 calls/step **≥2.0**。按 2.0 折算约可省 **2764 次**往返，
  是四条规则里**最大**的一笔未兑现收益。

**规则 3 — 后台任务用完成通知，禁止阻塞轮询**
- 长任务用 `run_in_background` 起 job，收到完成通知再取结果；**禁止** `job_output`
  设 `wait:true` 反复阻塞等待，也禁止 `sleep` 轮询。需要结果时再用短超时取一次。
- 现状（2026-11-02 复测，最近 3 天）：`job_output` 阻塞 >30 s **96 次 / 8.9 h**，其中
  **显式 `wait:true` 103 次**；字面 `sleep` 166 次 / 6.9 h；CI 轮询 236 次 / 4.9 h。
  这三项合计约占工具忙碌时长的 **22–27%**，是当前**最大**的可回收项。
- 目标：阻塞式 `job_output`（>30 s）与字面 `sleep` 各自下降 **≥50%**。

> **实测入口（规则 1–3 的唯一可信来源）**
> ```bash
> xp-gate runtime-journal --days 3          # 一屏摘要
> xp-gate runtime-journal --days 3 --json   # 机器可读，可做 A/B
> ```
> 该命令直接读 agent 会话日志，永远 exit 0（是诊断不是门禁）。**任何“规则已生效”的
> 结论必须以它的数字为准，而不是以规则是否存在为准**——2026-11-02 的复核就发现：
> 规则 1 生效（纯读取 shell 32.7% → 0.2%），而规则 2/3 几乎没有执行。

**规则 4 — 契约先测（发布流水线类改动）**
- 触及打包/发布/插件产物的改动，先写集成/契约测试（范式见 `plugins/dsh/src/contract.test.ts`），
  让“`npm pack --json` 被 stdout 污染”这类问题在本地就红，而不是等发布 CI 用 `jq` 语法错误才发现
  （0.32.2 的 dsh 插件正是这样漏发的）。
- 现状（2026-11-02）：本规则**没有时间型指标**——它的产物是「发布前就红」，不是「更快」。
  该有的度量是缺陷逃逸次数：0.32.2 的 dsh 插件 1 次漏发（契约测试引入前）。
- 目标：触及打包/发布的改动，契约测试先于实现提交；漏发次数保持 **0**。
  验证方式不是 `runtime-journal`（它只测工具调用效率），而是发布前
  `npm pack --json` + 契约测试是否真的跑过。
