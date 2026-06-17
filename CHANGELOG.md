# Changelog

All notable changes to this project will be documented in this file.

## [0.8.21] - 2026-06-17

### Refactored

- **Sprint Flow SKILL.md 大幅精简 (-64%)** — `skills/sprint-flow/SKILL.md` 从 76KB/1,444 行减至 27.8KB/491 行。所有 Phase 详细指令提取到 `references/phase-*.md`（13 文件，120KB）。编排规则提取到 `references/orchestration-rules.md`（17KB）。移除重复内容：Anti-Patterns、Output Format、Security Notes、Scope。使用示例 11→3。Phase 2/6/7/8 引用文件精简为 `@see SKILL.md` 指针。完整验证：13 个参考文件 + 6 个模板全部就位。

### Fixed

- **#232 — npm-publish CI 在 squash-merge 后未触发** — `.github/workflows/npm-publish.yml` 移除 `paths: [VERSION]` 过滤器。根因：GH Actions `paths` 过滤在 squash-merge commit 上不可靠（PR #231/#233 均受影响）。已存在的"Check existing CLI version"步骤提供等效的防重复保护。

### Changed

- 镜像同步：精简后的 sprint-flow skill 同步到 claude-code / opencode / qoder 插件目录及 npm 包内
- `@boyingliu01/xp-gate@0.8.21` 和 `@boyingliu01/opencode-plugin@0.8.21` 手动发布到 npm
- Git tag `v0.8.21` 创建并推送，GitHub Release 已创建
- `latest` dist-tag 修正为 0.8.21（CI 自动发布的 0.8.20 曾覆盖了 latest tag）

## [0.8.20] - 2026-06-17

### Fixed

- **#227 (P0) — xp-gate principles 在 npm global install 下找不到 principles/index.ts** — `src/npm-package/lib/principles.js` `findPrinciplesEntry()` 首位添加 `../principles/index.ts` 候选路径（npm bundled 布局）。`plugins/qoder/bin/xp-gate-check` 添加 `principles/index.ts` fallback 路径。
- **#228 (P1) — xp-gate install-skill 在 Qoder 下安装到 ~/.config/opencode/skills/** — 静态 `SKILLS_DIR` 改为动态 `getSkillsDir()`，按 `detectPlatform()` 返回 qoder/claude-code/opencode 对应 skills 目录。
- **#229 (P2) — xp-gate init 未写入 templateDir** — `installLocal()` 和 `setupGlobal()` 的 `updateConfig()` 加入 `templateDir: TEMPLATE_DIR`，确保写入正确的 platform 对应路径。

### Changed

- `src/npm-package/lib/install-skill.js`: 移除重复的 `detectPlatform` 导入（`detect-deps.js`），统一使用 `shared-paths.js` 版本。

## [0.8.19] - 2026-06-17

### Fixed

- **#218 — Delphi review Round 1→Round 2→Round 3 缺乏自动化调度机制** — `skills/delphi-review/SKILL.md` 新增 Orchestrator Dispatch Rules 章节（~76 行），定义自动多轮循环伪代码、终止结果输出格式、与 orchestrator 的交互约定。`skills/sprint-flow/references/phase-1-plan.md` 重写 Step 2b→Step 2c，delphi-review 在 subagent 内部自动多轮，只有最终 REQUEST_CHANGES（自动修复仍失败）才暂停。`skills/sprint-flow/references/phase-3-review.md` code-walkthrough subagent 自动多轮 + 自动修复尝试。全流程暂停点审计移除 Phase 6 冗余 PR 确认。
- **#225 — autoplan 被错误 dispatch 到 subagent 导致交互中断** — Phase Subagent Dispatch Matrix 拆分行：autoplan（`❌ orchestrator 直接执行`），delphi-review + to-issues（`✅ subagent`）。Phase 1 描述和完整流程箭头图更新。

### Changed

- **全流程暂停点审计** — 审计 Phase -0.5 到 Phase 8 所有暂停点，发现并移除 Phase 6 冗余双重确认（`finishing-a-development-branch` Step 2 已让用户 4 选 1，Step 3 重复确认）。暂停点从 3 个降至 2 个（仅保留 `finishing-a-development-branch` 和 `land-and-deploy 失败`）。
- **Middleware 暂停点矩阵更新** — `skills/sprint-flow/references/components/middleware.md` 移除 `ship PR` 暂停行，添加 #218/#225 变更说明。Delphi review 暂停点从"每轮暂停"改为"自动修复仍失败才暂停"。

## [0.8.18] - 2026-06-16

### Added

- **#181 — Qoder 平台 PreToolUse hook guard** — 新增 `plugins/qoder/hooks/hooks.json` + `bin/sprint-flow-guard.sh` + `bin/xp-gate-check`，与 Claude Code 插件结构对齐。PreToolUse 拦截 Edit/Write/ApplyEdit，读取 `.sprint-state/delphi-reviewed.json`，verdict != APPROVED 时 deny。PostToolUse 运行 principles check（graceful degradation）。Stop hook 输出提示信息。
- **#182 — Git-level Sprint Flow enforcement** — 新增 `githooks/sprint-gate.sh` 独立验证脚本。Pre-commit Gate 10：Phase 2 (BUILD) 时强制要求 delphi-review APPROVED。Pre-push Gate S：Phase 2+ 时强制要求 specification.yaml 存在 + delphi-review APPROVED。非 sprint 项目自动 SKIP（无 `.sprint-state/` 目录）。jq 缺失时 WARN 但 ALLOW（graceful degradation）。17 个 BATS 测试全部通过。
- **#183 — Qoder 插件 manifest + hooks 集成** — `plugins/qoder/plugin.json` 新增 `"hooks": "./hooks/hooks.json"` 字段，版本同步到 0.8.18。`githooks/verify.sh` 新增 4 项检查：sprint-gate.sh + Qoder hooks/hooks.json + sprint-flow-guard.sh + xp-gate-check。

### Changed

- **Pre-commit 从 9 gates 扩展到 10 gates** — Gate 10 (Sprint Flow Enforcement) 插入在 Gate 9 之后。Quality report 更新：TOTAL_GATES=10，新增 gate10_sprint_flow 字段，console 输出新增 Gate 10 行。
- **Pre-push 新增 Gate S** — Gate S (Sprint Flow) 插入在 Gate M 之前。验证 sprint state 一致性，确保 push 前 design review 已完成。

## [0.8.17] - 2026-06-16

### Added

- **#212 — OpenCode plugin auto-update** — `chat.message` hook triggers version check on first user message; inline semver compare (no external deps); npm registry dist-tags fetch (5s timeout, fail silent); 24h cache to `~/.xp-gate/opencode-plugin-version-check.json`; debounced one check per session.
- **#214 — `xp-gate sprint-status` CLI** — New command: `xp-gate sprint-status [--json] [--watch] [--dir <path>]`; table render with 11 phases, status icons, durations; REQ-level progress in BUILD phase; `--json` mode; `--watch` mode with fs.watch/fs.watchFile fallback + SIGINT cleanup; path traversal protection on `--dir`. 13 vitest tests passing.

## [0.8.16] - 2026-06-16

### Fixed

- **#217 — Sprint Flow Phase 0 subagent 卡死** — Phase Dispatch Matrix 中 Phase 0 THINK 的 `category` 从 `deep` 改为 `unspecified-high`，`load_skills` 从 `["brainstorming"]` 改为 `[]`。根本原因：`brainstorming` 为交互式 skill，注入独立 subagent session 后无用户可交互而卡死；`deep` 类别不适合结构化文档生成。
- **#210 — Gate 4 SOLID 检查在目标项目中永远被跳过** — `githooks/gate-4.sh` 和 `githooks/gates/gate-4-principles.sh` 新增第三级 fallback：检查 `$HOME/.config/xp-gate/modules/principles`（全局安装路径），确保 `xp-gate init` 未复制 `src/principles/` 到目标项目时 Gate 4 仍可执行。同时修复了 FAIL 分支中硬编码的 `src/principles/index.ts` 路径，改用 `$PRINCIPLES_DIR` 变量。
- **#211 — Gate M 变异测试在目标项目中永远被跳过** — `githooks/pre-push` 新增第三级 fallback：检查 `$HOME/.config/xp-gate/modules/mutation/gate-m.ts`，确保全局安装路径下仍可执行变异测试。
- **#188 — templateDir 指向 OpenCode 残留路径** — 已有 `xp-gate doctor --fix` 自动检测和修复机制（`shared-paths.js` 的 `getTemplateDir()` + `detectPlatform()`），该 issue 涉及的代码逻辑已完整实现，确认有效。
- **#216 — 本地 opencode-plugin 版本滞后无通知** — `xp-gate doctor` 新增 OpenCode 插件版本检测（Check 8）：读取 `~/.config/opencode/node_modules/@boyingliu01/opencode-plugin/package.json` 版本，与 xp-gate CLI 版本比对，不一致时输出 WARN 提示及手动升级命令。

## [0.8.15] - 2026-06-16

### Changed
- Version bump to 0.8.15.

## [0.8.14] - 2026-06-16

### Fixed
- **Doctor test timeout** — `seedVersionCache()` now writes to `os.homedir()/.xp-gate/` instead of `tmpHome/.xp-gate/` to match `check-version.js` which uses `os.homedir()` (not `process.env.HOME`) to compute `XP_GATE_DIR` at module load time.
- **AC-004-03 corrupt cache test ENOENT** — same root cause; corrupt cache write now targets correct path.

### Added
- **`check-version.js`** — per-version npm registry cache with skip logic; avoids network calls when cached version matches local version.
- **`upgrade.js`** — auto-update infrastructure for skill/plugin updates.
- **`post-merge` hook** — automatic update checks after git merge/pull.
- **`xp-gate-version-check.sh`** — Claude Code plugin version check hook.

### Changed
- All 870 npm-package tests pass (62 test files), all 10 pre-commit gates pass 10.0/10.

## [0.8.12] - 2026-06-15

### Changed
- **Gate 3/4/7/8/9 extracted from monolithic pre-commit** — cyclomatic complexity (Gate 3), principles checker (Gate 4), IaC security (Gate 7), secret scanning (Gate 8), and SAST security (Gate 9) each moved to standalone `githooks/gate-N.sh` files. BATS test suite added for all five (12 tests, all passing). Pre-commit script reduced by ~280 lines; each gate now self-contains its audit journaling.

### Fixed
- **#184 — Gate 3 and Gate 4 unconditional PASS overrides** — extraction naturally removed the `GATE_3_STATUS="PASS"` / `GATE_4_STATUS="PASS"` fallthrough that silently overrode actual skip/warning statuses.
- **#213 — pre-push DOC_ONLY bypass for new branches** — `git diff-tree HEAD` on a new branch with no base reported the entire file tree. Fixed by using `git diff MERGE_BASE...HEAD` to correctly compute the push diff.
- **#185 — 10× `✅ ... (SKIP)` output violations** — all pre-commit Gate 6 (architecture + Boy Scout) and pre-push Gate M2 (mock density) SKIP scenarios now use `⏭️  SKIPPED` prefix instead of `✅` checkmark. PASS now exclusively means the check actually ran.

## [0.8.11] - 2026-06-14

## [0.8.9] - 2026-06-11

### Fixed
- **#208 — OpenCode plugin's 3 tools were broken after clone** — `gate-check`, `gate-principles`, `gate-arch` shelled out to `xp-gate` subcommands that were never registered (`xp-gate check`, `xp-gate principles`, `xp-gate arch`) and to the wrong archlint package name (`npx archlint check` instead of `npx @archlinter/cli scan`). `gate-check` and `gate-arch` had no fallback path either, so they silently no-opped or crashed.

### Added
- **3 new CLI subcommands** — `xp-gate check <path>`, `xp-gate principles <path>`, `xp-gate arch [--config ...]`. Total registered subcommands grew from ≥11 to ≥15. Each one is the canonical implementation for the OpenCode plugin tool of the same name; both call paths produce identical output.
- **OpenCode plugin npx-tsx fallback for all 3 tools** — every tool now uses a chained shell-out (`command -v xp-gate && xp-gate <cmd> || npx -y tsx <source>`) so the tools work both with a globally installed `xp-gate` CLI and from a fresh clone of the repo. Matches the existing graceful-degradation pattern from the Claude Code plugin's `xp-gate-check`.
- **Plugin↔CLI contract documentation** — `plugins/opencode/README.md` now explicitly documents that `gate-check`/`gate-principles`/`gate-arch` are dual-surface (OpenCode tool + CLI subcommand) and that both paths produce identical output.

### Follow-up
- **#209 filed** — investigate why the OpenCode plugin originally shelled out to never-registered subcommands. Suggests CI check to diff plugin shell-outs against `bin/xp-gate.js` `COMMANDS` map to prevent future drift. Backlog (p3-low).

## [0.8.8] - 2026-06-09

### Fixed
- **#186 — P1: Global version mismatch detection** — `xp-gate doctor` now detects when installed config version differs from package version. `xp-gate doctor --fix` auto-syncs config version and updates global hooks from package source.
- **#187 — P2: Windows/Qoder bash hooks pip3 compatibility** — Replaced `pip3` with `pip` in pre-commit lizard install message and TOOL-INSTALLATION-GUIDE.md for cross-platform compatibility.
- **#188 — P2: templateDir pointing to OpenCode residue path** — `shared-paths.js` now dynamically resolves `TEMPLATE_DIR` based on detected AI agent platform (opencode/claude-code/qoder). `xp-gate doctor` validates templateDir against current platform; `--fix` auto-corrects it.

## [0.8.2] - 2026-06-08

> **Note**: This entry was marked "Unreleased" in error during 0.8.x rapid iteration. The features below shipped as part of the 0.8.2 → 0.8.8 release wave on 2026-06-08/09. See issue #205 for the fix.

### Added
- **#135 — OpenCode plugin auto-configure in xp-gate init** — `xp-gate init` now detects opencode.json in the project root and automatically injects the bundled plugin path. No more manual editing of opencode.json after npm install.
- **Gate 0: SKIP_VERSION_CHECK env var bypass** — add `SKIP_VERSION_CHECK=1` env var as a reliable bypass for `git commit -m` (which can't use the `[skip-version-check]` commit message prefix since COMMIT_EDITMSG isn't populated before the pre-commit hook runs). Usage: `SKIP_VERSION_CHECK=1 git commit -m "message"`
- **#148 — Resume Gate stale detection** — Add RESUME GATE to sprint-flow with 5 validations: sprint ID consistency, phase ordering, git isolation branch reachability, file mtime staleness vs phase completion time, specification.yaml staleness for `--resume-from build`
- **#137 — Ralph-loop objective TDD enforcement** — Add pre-REQ git HEAD snapshot baseline, L1b git-diff based test-first ratio check (test_lines ≥ 40%), L1b-alt test file presence check
- **#142 — VERSION serialization changeset model** — Add `.sprint-state/changesets/` directory for atomic version tracking. changeset JSON includes id, sprint_id, old/new version, change_type, files_changed. Created on every VERSION bump in Phase 6 before commit.
- **#144 — Sprint lock prevent concurrent sprints** — Add `.sprint-state/sprint.lock` lockfile mechanism. Phase -1 checks for existing lock, detects stale (24h+ or orphan worktree). Non-stale active lock BLOCKs new sprint. Phase 8 releases lock on cleanup.
- **#146 — sprint-state.json enforcement** — Phase Transition Gate now verifies `phase_history` includes current phase with `completed_at` set. BLOCK if entry missing or completed_at is null, with clear remediation instructions.

### Changed
- `release: v0.8.1.1` — adapter deduplication + Gate 0 bypass fix (committed directly as 8cb552c, no CHANGELOG entry at time of micro bump)

## [0.8.1] - 2026-06-07

### Fixed
- **#170 — pre-push hook fatal: bad object on remote branch deletion** — detect `local_sha=000...000` for branch deletion events and skip validation
- **#171 — archlint configured but not enforced** — install `@archlinter/cli@0.16.0`, create `.archlint.yaml`, update pre-commit hooks with `npx --no-install` support
- **#172 — ui-detector.ts coverage below 80%** — add 18 new CLI tests (direct process mocking), line coverage 96.52%
- **#173 — boy-scout.ts function coverage 56%** — add 17 new tests including `runEnforcement`, `parseArgs`, `splitCsvArg`, `showHelp`; 92% line, 91% function
- **#174 — many-exports.ts + lsp.ts branch coverage** — add targeted tests for branch/edge cases; 100% line coverage for both files
- **#176 — documentation version markers stale** — update all 25+ AGENTS.md files and README.md from v0.5.1 to v0.8.1
- **#175 — Gate 0 script file exemption** — exempt `.sh` files from "source code" detection in version consistency check; commits containing only shell scripts no longer require VERSION/CHANGELOG update
- **#177 — adapter deduplication** — add `syncAdapters()` to sync-package-content.js so `githooks/adapters/` is the single source of truth; `npm-package/adapters/` is now a build artifact. Fixes java.sh divergence (whalecloud grep typo)
- **Gate 0 bypass fix** — `[skip-version-check]` now reads from COMMIT_EDITMSG and allows build-tooling files (adapters/, scripts/, hooks/) while still blocking production source code

### Removed
- **SonarQube Gate 8** — full deletion of SonarQube support: `docs/sonarqube-setup.md`, `sonar-project.properties`, `.github/workflows/sonarqube.yml`, design plans, AGENTS.md references

## [0.8.0] - 2026-06-06

### Fixed
- **#143 — SHA self-reference paradox in pre-push** — resolve circular dependency when checking HEAD vs remote
- **#154 — coverage config drift** — fix vitest coverage configuration consistency
- **#155 — command injection SAST** — secure git diff calls with spawnSync array args
- **#157 — mutation timeout** — increase stryker dry-run timeout to 600s matching `stryker.conf.json`
- **#167 — fake tsc@2.0.4 blocking First Commit Gates** — resolve phantom tsc dependency issue

### Changed
- **#149 — expand first-commit-gates CI** — exercise all 6 quality gates in CI pipeline
- **#150 — mutation watchdog** — add actionable PR comment + watchdog on timeout
- **#153 — reduce all functions CCN** — refactor to ≤10 threshold, remove dual-tier system
- **#163 — pre-push code-walkthrough** — resolve SHA self-reference paradox

## [0.7.2] - 2026-06-06

### Removed
- **Issue #140 — skill evaluation/certification artifacts** — 彻底清理 xp-gate 中所有与 skill 评估/验证/认证无关的历史残留内容：
  - 删除 `docs/skill-validation/` 完整目录（validation framework、methodology、summary、eval-cases、promptpressure）
  - 删除 `docs/skill-validation-framework.md` 和 `docs/skill-validation-methodology-landscape.md`
  - 删除 `docs/plans/*skill-cert*` 3 份设计文档
  - 删除 `docs/fusion/matt-pocock-skills-vs-xgate-analysis.md`
  - 删除 `skills/*/evals/` 和 `skills/*/evolution-*` 共 8 个源文件 + npm-package 镜像副本中 6 个对应文件
  - 删除 `.github/workflows/skill-cert-eval.yml` 独立 workflow
  - 从 `.github/workflows/quality-gates.yml` 移除 `skill-cert-check` job 及相关引用
  - 清理 `AGENTS.md`、`CAPABILITIES.md`、`docs/AGENTS.md` 中所有 skill-cert 耦合描述
- **Root 目录清理**：
  - 删除残留 `architecture-report.sarif.json`
  - 移动 `specification-fix-issues.yaml` → `docs/plans/`
  - 更新 `.gitignore` 覆盖 transient 报告文件

## [0.7.1] - 2026-06-06

### Fixed
- **Issue #147 — Gate 1 lint errors** — 修复 Gate 1 lint 错误并拆分 boy-scout 测试，使其通过 large-file 规则（PR #147）
- **Issue #139 — stale promptfoo refs** — 清理 promptfoo 历史残留引用、同步 npm-package skills 副本、为轻量级 Delphi route 强制启用 gate（PR #139）
- **vitest coverage 排除 .worktrees** — `vitest.config.ts` 在 coverage.exclude 中补齐 `.worktrees/**`（test.exclude 已有，coverage 缺漏），避免 worktree 残留 HTML 报告 JS 文件被纳入 coverage 总数（之前导致 Gate 5 阈值误判）

### Changed
- **Version consolidation 0.7.1** — 合并 0.6.2（main 上累积未发布的 bugfix #139/#147）+ 0.7.0（Qoder 集成迭代分支引入的 MINOR bump），统一对齐到 0.7.1 作为下一个发布版本
- **VERSION 同步覆盖扩展** — 同步更新 `src/npm-package/plugins/claude-code/.claude-plugin/plugin.json` 内嵌副本（sync-version.sh 当前未覆盖此路径，已手工修正）
- **AGENTS.md 版本注释** — `src/npm-package/AGENTS.md` 的 stale 版本注释（0.5.1 → 0.7.1）

### Notes
- Issue #144（分布式事务：active sprint instance lock + rebase-before-commit guard）仍为 OPEN，本版本未实现
- `npm-publish` workflow 仅在 `VERSION` 文件变更时触发——这是 #139/#147 此前未触发发布的根因（两个 bugfix 均未 bump 版本）

## [0.5.1] - 2026-05-30

### Added
- **REQ-1: xp-gate uninstall CLI** — 完整卸载命令，镜像反转 init，支持 dry-run/force 参数，manifest 文件跟踪
- **REQ-2: xp-gate doctor CLI** — 诊断命令，检查 config/hooks/adapters/core.hooksPath/env，支持 --fix 自动修复
- **REQ-3: xp-gate migrate CLI** — v0.4.x 迁移助手，自动清理 ~/.npmrc GitHub Packages PAT 残留
- **REQ-5: Windows 兼容验证** — CI matrix 添加 windows-latest runner，Node 18/20/22 LTS 全部通过

## [0.6.2] - 2026-06-04

### Added
- **sprint progress renderer** — `scripts/render-sprint-progress.cjs` 可执行 Node.js 脚本，读取 sprint-state.json 并输出 ASCII 进度看板（替代纯声明式模板渲染）

### Changed
- **sprint-flow SKILL.md** — PHASE TRANSITION RULES Step 4 和 `--status` 参数改为调用 `node scripts/render-sprint-progress.cjs`（确定性渲染，不再依赖 AI 主动执行模板）
- **plugin/skill 副本同步** — qoder + npm-package sprint-flow SKILL.md 同步更新

## [0.6.1] - 2026-06-04

### Added
- **sprint-flow VERSION-GATE** — Phase 6 SHIP 强制每个 sprint bump PATCH 版本，确保 skill-only 变更也触发 npm 发布
- **skill-cert CI job** — quality-gates.yml 新增 skill-cert-check job，PR 中 skills/ 目录变更时自动触发 skill-cert 评估（continue-on-error）
- **sprint progress dashboard** — 进度看板模板 + `--status` 参数（sprint-2026-06-04-01 交付）

### Changed
- **版本 bump 规则** — 每完成一个 sprint 统一 bump PATCH，不区分 skill/code 变更类型

## [0.4.1.0] - 2026-05-30

### Fixed
- **Issue #80: Delphi-review skip prevention** — LLM 可跳过 delphi-review 直接进入 BUILD，新增三层防御架构：L1 PreToolUse Hook 物理拦截 (IDE 层)、L2 DELPHI-GATE Phase 2 入口门禁 (SKILL.md)、L3 状态文件输出 (delphi-review APPROVED 后生成 .sprint-state/delphi-reviewed.json)
- **Issue #82: Phase 5 FEEDBACK bypass** — Phase 4 推迟后跳过 Phase 5 直接进入 Phase 6，新增 Phase 4→5→6 双重硬门禁：Phase 5 声明"不可跳过" + Phase 6 入口验证 feedback-log.md 存在

### Added
- **plugins/claude-code/bin/delphi-review-guard.sh** — PreToolUse Hook 守卫脚本，检查 .sprint-state/delphi-reviewed.json，不支持 jq 时优雅降级

### Changed
- **middleware.md 状态机增强** — 添加 DELPHI-GATE + Phase 5 硬门禁转换规则（"永远不可自动跳过"）
- **README.md** — 新增 v0.4.x → v0.5.x 迁移指南，移除 GitHub PAT 认证步骤，安装流程简化为 `npm install -g xp-gate`
- **MANIFEST.md** — 7 个 `bash <(curl ...)` 安装命令标注为 "LEGACY - GHP version only"
- **CHANGELOG.md** — 补充 REQ-6 迁移相关变更记录

## [0.3.2.0] - 2026-05-28

### Fixed
- **sync-version.sh CRLF** — 去掉 `set -euo pipefail` → `set -eu`，Windows Git Bash 不再报错 `$'\r': command not found` 和 `invalid option name`（fixes #74-A）
- **Ship workflow version drift** — pre-commit hook 新增 Gate 0 版本门禁，在 main/master/develop 等保护分支上强制 VERSION/CHANGELOG 更新，防止绕过 ship 流程（fixes #74）

### Added
- **.gitattributes** — `*.sh text eol=lf` 确保所有 shell 脚本统一 LF 行尾，彻底解决跨平台 CRLF 问题
- **Sprint-Flow Phase 7 LAND** — 集成 `land-and-deploy` skill，PR 创建后自动 merge + 等 CI + canary health check（fixes #71-A）
- **Sprint-Flow Phase 8 CLEANUP** — 自动 `git worktree remove` + sprint-state.json 更新 + 残留检测（fixes #71-B）
- **Gate 0 version consistency check** — 保护分支提交需包含 VERSION 或 CHANGELOG.md 变更，绕过条件收紧为 `chore:/docs:/release:` 前缀 + 无源码变更
- **Phase 7 health check + auto-rollback** — SLA 指标（HTTP 200, 错误率 <1%, p99 <2s），部署失败自动 `git revert` merge commit

## [0.3.1.1] - 2026-05-25

### Fixed
- **ralph-loop dispatch** — `category="build"` (invalid) → `category="unspecified-high"`，修复 skill 静默加载失败
- **TDD 纪律注入** — subagent context 显式注入 TDD 铁律 + Mock 边界，不再依赖 `load_skills` 软约束
- **测试基础设施先行** — 业务代码 dispatch 前检查 test-utils.ts 存在性及接口契约（createTestApp, withTestDb）
- **状态机一致性** — 新增 test_infra_check/dispatch/ready 状态，所有路径经 test_infra_ready 再进 in_progress
- **引用一致性** — `slices-manifest.json` → `specification.yaml` 在 2 个组件文档中修正

### Added
- **L1b 测试先行比率门** — 新增测试行数 / (新增测试 + 新增实现) ≥ 40%
- **4 个 eval 用例** — ralph-015 (category 修正) + ralph-016/017/018 (test-infra 场景覆盖)
- **Progress Log 增强** — `**Test infra**` 字段（generated/existing/skipped/fallback）
- **Memory.md 扩展** — Progress Log Schema 新增 `test_infra_status` 字段定义

## [0.3.1] - 2026-05-25

### Fixed
- **Pre-push hook crash** — Gate M 不再因 `src/mutation/gate-m.ts` 不存在而崩溃，改为优雅跳过并输出警告（fixes #63）

## [0.2.0] - 2026-05-21

### Added
- **`/to-issues` skill** — 垂直切片问题拆分，Delphi Round 2 APPROVED (3/3)
- **`/improve-codebase-architecture` skill** — 定期架构健康检查，发现架构腐化和死代码
- **CC-010: Many Exports Rule** — 单模块导出数 ≤10 个（named exports + re-exports），解决#61 分层架构治理问题
- **brainstorming 增强** — 自动创建 `CONTEXT.md` + `ADR` 记录共享语言，Delphi Round 2 APPROVED (3/3)
- **Delphi Review 增强** — specification.yaml 新增 User Stories 层级，增加 US→REQ→AC→test 追溯链
- **Sprint Flow 集成 `/to-issues`** — Phase 1 PLAN 和 Phase 2 BUILD 融入任务拆解流程
- **Matt Pocock 5 Skills 融合分析文档** — `docs/fusion/matt-pocock-skills-vs-xp-gate-analysis.md`

### Changed
- **Clean Code 规则** — 9→10 条（新增 many-exports CC-010）
- **README.md** — 新增"最大化 XP-Gate 价值"实战指南章节
- **sprint-flow** — Phase 1→2 融入 `/to-issues` 任务拆解
- **13 语言适配器** — TypeScriptAdapter 新增 `extractExports()` 方法
- **Brainstorming** — 增加 CONTEXT.md 惰性创建机制（≥2 领域术语才生成）

### Documents
- `docs/fusion/matt-pocock-skills-vs-xp-gate-analysis.md` — 融合矩阵与执行状态

## [0.1.2] - 2026-05-20

### Added
- **xp-gate npm 包** — `npm install -g xp-gate` 零安装体验，无需 clone 仓库
- **`xp-gate init`** — 初始化项目，自动安装 hooks + adapters + 依赖检测
- **`xp-gate install-skill <name>`** — 从 GitHub 按需下载并安装 AI 技能
- **`xp-gate update-skill <name>`** — 更新已安装的 Skill 到最新版本
- **`xp-gate uninstall-skill <name>`** — 卸载指定 Skill
- **依赖检测** — `detect-deps.js` 支持 superpowers/gstack 版本检查
- **安装回滚机制** — 安装失败自动恢复备份，保证干净状态
- **离线缓存** — `xp-gate install-skill --offline` 使用本地缓存
- **配置文件** — `~/.config/xp-gate/xp-gate.json` 记录已安装 Skills 和元数据

### Changed
- **快速开始** — README 新增 "方式零：零安装（推荐）"
- **依赖检测路径** — 同时搜索 `~/.config/opencode/skills/` 和 `~/.config/opencode/` 两个位置

### Documents
- 设计文档：docs/plans/2026-05-19-xp-gate-zero-install-design.md v2.0
- 评审报告：docs/plans/2026-05-19-xp-gate-zero-install-consensus-report.md
- 需求规格：docs/plans/2026-05-19-xp-gate-zero-install-specification.yaml

## [0.1.1] - 2026-05-09

### Added
- **ralph-loop skill** — REQ 级别迭代构建模式，Delphi 双专家 APPROVED (9/10)
- **逐 REQ 迭代** — 每个 REQ dispatch 独立 subagent，干净上下文，token 节约 40-67%
- **全量回归测试** — 每个 REQ 完成后运行 ALL tests，检测跨 REQ 回归
- **拓扑排序** — Kahn's algorithm 处理 depends_on 依赖，循环依赖自动检测
- **分类 Learnings** — permanent（架构级始终传递）+ contextual（最近 3 条滑动窗口）
- **3 层验证 Gate** — L1: typecheck+lint → L2: 全量测试 → L3: coverage ≥ 80%
- **崩溃恢复** — atomic checkpoint + git history 天然持久
- **完整的 eval 测试集** — 15 个测试用例覆盖所有关键路径
- **Phase 2 BUILD ralph-loop 模式** — sprint-flow 文档已更新

### Changed
- **Phase 2 BUILD 默认行为** — ralph-loop 从"可选模式"升级为默认模式
  - `/sprint-flow "需求"` → 自动使用 ralph-loop 逐 REQ 迭代
  - `/sprint-flow "需求" --mode parallel` → 旧有并行模式（可选）
- **maturity**: ralph-loop beta → stable

### Documents
- docs/ralph-loop-design.md v4.0 — 完整设计文档 + Delphi 评审记录
- skills/ralph-loop/references/phase-2-build-ralph.md — 集成文档重写
- skills/sprint-flow/SKILL.md — Phase 2 默认行为更新，参数交互更新

## [0.1.0] - 2026-05-05

### Added
- **Sprint Flow 全流程编排** — 一键启动 Think→Plan→Build→Review→Ship 7 阶段开发流水线
- **Phase 0: THINK** — brainstorming 需求探索，HARD-GATE 设计未批准不可实现
- **Phase 2: PARALLEL BUILD** — dispatching-parallel-agents 并行任务分发，executing-plans 隔离执行
- **Phase 3: REVIEW** — browse 浏览器自动化测试，test-spec-alignment 测试对齐
- **Phase 5: FEEDBACK** — retro 工程回顾，systematic-debugging 根因调试
- **Phase 6: SHIP** — finishing-a-development-branch 4 选项发布决策 (merge/PR/discard/keep)
- **Web 前端支持** — web-nextjs/web-react/web-vue 项目类型检测
  - design-shotgun UI 设计多版探索、qa 系统化测试、design-review 视觉审计、benchmark Core Web Vitals
- **移动端支持** — mobile-flutter/mobile-react-native 项目类型检测
  - flutter.sh 适配器 (flutter analyze/test)、flutter-test integration
- **CI/CD 集成** — GitHub Actions workflow (.github/workflows/quality-gates.yml)
- **负载/压力测试** — k6/locust/gatling 工具映射、.sprint-load-test.yaml 规范
- **API 测试** — Phase 3 API 自动化测试支持 (Go/Spring Boot/Django)
- **安全审计** — gstack/cso 全面替代 security-scan (15 phases 安全审计)
- **完整文档体系**：
  - README.md 全面重写 (381 lines，12 语言适配器 + Sprint Flow 流程图 + 配置说明)
  - ARCHITECTURE.md 新增 (818 lines，5 层架构图 + 分层详解 + 数据流)
  - CAPABILITIES.md 新增 (300 lines，完整能力清单矩阵)
- **project type 自动检测** — 8 种项目类型 (web/mobile/backend)

### Changed
- **Sprint Flow Phase 0** — office-hours → brainstorming (HARD-GATE 机制)
- **Sprint Flow Phase 3** — cross-model-review → delphi-review --mode code-walkthrough
- **6 道质量门禁适配 Flutter/PowerShell** — flutter.sh + powershell.sh 适配器
- **pre-commit 钩子** — 支持 React Native 检测 (package.json + react-native)
- **adapter-common.sh** — flutter/powershell 语言检测

### Fixed
- #6: specification-generator 触发器集成到 delphi-review
- #11/#13/#15: 管道退出码、pytest 误报、分支覆盖率
- #17: 6 个新语言适配器 (cpp/swift/objectivec/dart/flutter/powershell)
- #18: PowerShell 质量门禁
- #20: 质量门禁报告汇总
- #21: Stryker Mutation Testing Gate
- #26: cross-model-review → delphi-review --mode code-walkthrough
- #28: Web 前端项目支持
- #29: dispatching-parallel-agents 并行执行
- #30: Phase 0 brainstorming 替代 office-hours
- #31: Phase 6 finishing-a-development-branch
- #32: Phase 5 retro + systematic-debugging
- #33: 移动端支持 (Flutter/RN)
- security-scan → cso 安全能力覆盖验证

### Language Support (12 adapters)
TypeScript, Python, Go, Shell, Java, Kotlin, C++, Swift, Objective-C, Dart, Flutter, PowerShell

## [0.0.6] - 2026-04-30

### Added
- **Gate 9: Architecture Quality** - Clean Architecture layer boundary validation
  - TypeScript: archlint (@archlinter/cli) >= 2.0.0
  - Python: import-linter >= 2.0.0
  - Go: arch-go >= 1.7.0
  - Java: ArchUnit
  - C++: Phase 2 roadmap (requires `.skip-architecture-cpp` marker)
- **architecture.yaml** template with layer definitions and rules
  - 14 architecture rules: ARCH-001 to ARCH-014
  - Layer boundary enforcement (Domain, Application, Infrastructure, Presentation)
  - Circular dependency detection
  - Baseline/ratchet mode support
  - SARIF output integration
- **version-parser.ts**: Tool version compatibility checker
- **Gate 9 bats tests**: 18 test cases for shell script validation

### Changed
- Gate count: 8 → 9 (added Architecture Quality)
- TOOL-INSTALLATION-GUIDE.md: Added architecture tool installation
- README.md: Added Gate 9 documentation
- specification.yaml: Added REQ-ARCH-001 to REQ-ARCH-009

### Delphi Review Verified
- Round 1 → Round 2 → APPROVED (100% consensus, 9.67/10 confidence)
- Experts: delphi-reviewer-architecture, delphi-reviewer-technical, delphi-reviewer-feasibility
- Critical issues fixed: tool name, version checks, C++ skip marker

## [0.0.4] - 2026-04-14

### Fixed
- **Issue #7**: Code walkthrough pre-push hook CLI invocation error
  - Root cause: OpenCode CLI doesn't support skill subcommands
  - Solution: Replace CLI call with file validation (`.code-walkthrough-result.json`)
  - Hook validates: commit match, verdict=APPROVED, not expired (<1hr)
  - Skill executes in Agent session, writes result file
  - Decision: "mandatory but manually triggered" quality gate
- **Delphi Review**: code-walkthrough Round 1-3 → APPROVED (Expert A/B 9/10)

### Changed
- `githooks/pre-push`: 305 → 145 lines (file validation only)
- `skills/code-walkthrough/SKILL.md`: 276 → 469 lines (added result output)
- OpenCode environment: synced with latest fixes

### Added
- **specification-generator UPDATE mode**: Modify existing spec with Delphi review

## [0.0.3] - 2026-04-14

### Added
- **Boy Scout Rule** (Gate 8): Differential warning enforcement for historical projects
  - `boy-scout.ts`: File classification, delta calculation, baseline management
  - `baseline.ts`: Warning history storage (.warnings-baseline.json)
  - New files: zero-tolerance, Modified files: decrease-or-maintain
- **Objective-C Adapter**: Regex-based extraction for .m/.mm files
  - @implementation/@interface parsing
  - Objective-C method declarations
- **C++ Adapter**: Regex-based extraction for .cpp/.c/.h files
  - Function extraction with const/override/noexcept
  - Class/struct with inheritance
- **Gate 7 CCN**: lizard integration for C++/Objective-C cyclomatic complexity
- **Test annotations**: @test REQ-XXX, @intent, @covers AC-XXX format
- **specification.yaml**: YAML-based requirements and acceptance criteria

### Changed
- Gate count: 7 → 8 (added Boy Scout Rule)
- Language adapters: 7 → 9 (added C++, Objective-C)
- Test count: 166 → 257 tests
- Coverage: 94% → 85%+ (still above threshold)

### Fixed
- TypeScript strict mode issues in test files
- AdapterFactory null return type handling
- LSP rule parameter type annotation

### XP Consensus Verified
- Gate 1: PASS (TypeScript + Tests + Coverage)
- Navigator Phase 1: REQUEST_CHANGES
- Navigator Phase 2: APPROVED (confidence 10/10)
- Arbiter: APPROVED

## [0.0.2] - 2025-04-11

### Added
- **Hook-based Quality Gates**: Code-level enforcement replacing soft prompt constraints
- **Iron Law Workflow**: Mandatory verification before implementation
- **Delphi Review System**: Multi-expert consensus (≥90% threshold)
- **XP Consensus Engine**: Driver + Navigator + Arbiter decision workflow
- **Code Walkthrough**: Multi-model post-commit review
- **Test-Specification Alignment**: Two-phase verification

### Changed
- Addressed AI agent "shortcut-taking" problem from v0.0.1
- Zero-tolerance for quality gate tools availability
- No degradation on cost/environment issues

### Design Decisions
- Hook-based gates over stronger prompts (100% reliability vs ~30%)
- SARIF 2.1.0 output for IDE integration
- Skills as SKILL.md markdown (not executable code)

## [0.0.1] - 2025-03-XX

### Added
- Initial XP-Gate framework
- Principles checker with Clean Code + SOLID rules
- Git hooks framework
- Basic skill structure

### Known Issues
- AI agent shortcut-taking behavior (addressed in v0.0.2)
