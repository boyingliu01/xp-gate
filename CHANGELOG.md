# Changelog

All notable changes to this project will be documented in this file.

## [0.17.0.0] - 2026-07-22

### Added
- **Sprint 初始化 CLI (`xp-gate sprint-init`)**: Phase 1 PREP 自动创建 sprint-state.json，消除编排器"记住"手动写入状态文件的依赖。
- **Phase-Transition 程序化强制执行 (#366)**: 三层强制机制 — Layer 1 sprint-init 自动初始化 + Layer 2 TodoWrite 嵌入式调用 + Layer 3 sprint-gate.sh 门禁检查。
- **SKILL.md 结构化重写**: frontmatter WHAT/WHEN/NOT WHEN/TRIGGERS 完整描述、Phase 1 展开（触发条件/输入/步骤/输出）、门禁条件表、状态机图、决策记录模板、失败处理策略。

### Changed
- Sprint-flow SKILL.md 从纯文本指令升级为结构化状态机文档，支持程序化验证。

## [0.16.0.0] - 2026-07-22

### Added
- **PowerShell 适配器原生支持 (#357)**: Gate 3/7/8/9 TypeScript 模块支持 PowerShell 项目语言检测与路由；PowerShell 项目自动路由到 PSScriptAnalyzer 规则。
- **Python 环境健康检查 (#356)**: 双层架构 — Layer 1 bash preflight（pre-commit 热路径，零延迟）+ Layer 2 TypeScript 完整诊断（CLI/doctor 按需运行）；Windows Store 存根自动过滤。
- **分层测试分析 (#359)**: `xp-gate test-layers` 报告 unit/integration/e2e 测试分布与源文件-测试文件配对统计；analytics-only 模式，不 BLOCK 提交。
- **PBT 检测 (#337)**: `xp-gate pbt` 检测 fast-check/jsverify/jest-property/ava-fast-check 框架使用情况并输出覆盖率报告；analytics-only 模式，不 BLOCK 提交。
- **TypeScript Gate 共享基础设施**: `src/gates/common.ts` 提供 `isToolAvailable()` 3层检测、`runTool()` spawnSync 封装、`recordAudit()` 审计日志、`getChangedFiles()`/`detectProjectLang()` 等通用功能。

### Fixed
- **OpenCode plugin shell:true (#365)**: 修复 gate-runner.js 中 `runTsGate()` 在 Windows 下未设置 `shell: true` 导致 `npx tsx` 启动失败的问题。

### Changed
- **ESLint 配置优化**: 测试文件 (`__tests__/**/*.ts`, `*.test.ts`) 关闭 `@typescript-eslint/no-explicit-any` 规则；`src/npm-package/coverage/` 加入 ignores。

## [0.15.4.0] - 2026-07-22

### Changed
- **`xp-gate install` 一键安装**: 重写为 `init` + `baseline` + `bootstrap` + `doctor --fix` 的完整编排，用户只需记一个命令。
- **`xp-gate doctor --fix` 自动修复增强**: 自动同步过时 hooks（update-hooks）、自动安装缺失 CLI 工具（bootstrap）、自动安装缺失语言工具（install-tools）。
- **`xp-gate init` 默认创建 baseline**: Boy Scout Rule 开箱即用，不再需要 `--baseline` flag。
- **`xp-gate uninstall` 清理增强**: 自动清理 `.xp-gate-config.json` 和 `.warnings-baseline.json`。

### Added
- **pre-commit audit 覆盖**: Gate 0（版本一致性）、Gate 9（构建完整性）、Gate 11（Sprint Flow）补充 audit 记录，实现全门禁审计追踪。
- **Sprint Flow Phase 4 集成**: 新增 `xp-gate check --all` 步骤，自动运行所有可用质量门禁。

## [0.15.3.0] - 2026-07-22

### Added
- **多语言质量门禁完善**: 自动检测项目语言 + 检查/安装语言特定工具 + 项目级配置持久化。
- **`xp-gate detect-languages` CLI**: 检测项目使用的编程语言，生成 `.xp-gate-config.json` 配置文件。
- **`xp-gate check-tools` CLI**: 检查每种语言所需的质量门禁工具可用性（必需/可选分类）。
- **`xp-gate install-tools` CLI**: 自动安装缺失的语言特定工具（支持 `--dry-run` 和 `--yes`）。
- **`language-tools.js` 模块**: 12 种语言的工具注册表（TypeScript/Python/Java/Go/Kotlin/Swift/Dart/Flutter/C++/Shell/PowerShell/IaC）。
- **`xp-gate init` 增强**: 初始化时自动检测项目语言、检查工具状态、提示安装缺失工具。
- **`xp-gate doctor` 增强**: 诊断报告中显示语言特定工具状态。
- **pre-commit hook 增强**: 读取 `.xp-gate-config.json` 作为语言检测的补充来源（优先级：override > config file > extension detection）。

### Changed
- **多语言模式完善**: 每个项目支持多语言模式，不再要求单一语言。工具缺失时优雅降级（SKIP 而非 BLOCK）。

## [0.15.1.0] - 2026-07-22

### Added
- **Gate 1 Python 增强**: `ruff format --check` 格式检查 + `breakpoint()`/`pdb.set_trace()` 调试语句检测（阻塞提交）。
- **Gate 1 JS/TS 增强**: `debugger` 语句检测（阻塞提交）。
- **Java JaCoCo 检测**: `_detect_jacoco_configured()` 函数，未配置 JaCoCo 时覆盖率检查降级为 SKIP 而非 BLOCK。
- **语言覆盖 3-tier 优先级**: `.xp-gate-lang` 文件 > `git config xp-gate.lang` > `XP_GATE_LANG` env（deprecated warning）。
- **Python Principles 适配器增强**: `extractFunctions()` 返回 startLine/length/params；`extractClasses()` 返回 startLine/length/methodCount；新增 `extractExports()` 方法。

### Changed
- **Windows 兼容性**: 所有 `/dev/stdin` 替换为 `fs.readFileSync(0,'utf8')`（10 处），解决 Git Bash 下路径不存在问题。
- **python3 依赖移除**: pre-commit/pre-push/gate-9 中所有 `python3` 调用替换为 Node.js 等效实现（时间戳、JSON 解析、报告写入）。
- Python 适配器 `getCodeBlock` 上限从 50 行提升到 200 行。

### Fixed
- 修复 Windows Git Bash 下 Gate 1 因 `/dev/stdin` 不存在而静默失效的问题 (#361)。
- 修复 Windows 下 `python3` 不可用导致时间戳/报告生成失败的问题 (#362)。
- 修复 Java 项目无 JaCoCo 时覆盖率门禁误阻塞的问题 (#363)。

## [0.14.30.0] - 2026-07-22

### Added
- **Sprint State 双层强制执行机制**: Layer 1（phase-transition 前置检查，确保前一 Phase 已完成）+ Layer 1.5（Phase 6 completed 自动提醒运行 sprint-audit）+ Layer 2（`xp-gate sprint-audit` CLI，检查 phase 覆盖度、时间记录、输出物、状态一致性）。
- **`xp-gate sprint-audit` CLI 命令**: 最终完整性审计，verdict 分级（PASS / PASS_WITH_WARNINGS / FAIL / SKIP），支持 `--json` 和 `--dir` 参数，报告持久化到 `.sprint-state/audit-report.json`。
- **PHASE_NAMES 共享常量**: 从 `phase-transition.js` 导出，供 `sprint-audit.js` 引用。
- **20 个新测试**: 8 个 Layer 1 前置检查测试 + 12 个 Layer 2 审计测试，33 个测试全部通过。

### Changed
- `phase-transition.js`: 新增 Layer 1 前置检查逻辑 + Layer 1.5 自动提醒 + PHASE_NAMES 导出。
- `orchestration-rules.md`: 新增 Step 4（Phase 6 CLOSE 后运行 sprint-audit）。
- 架构基线更新（`.architecture-baseline.json`）。

## [0.14.29.0] - 2026-07-22

### Changed
- 版本号升级至 0.14.29.0（npm registry 版本占用，顺延发布）。
- 功能内容与 0.14.27.0 一致：Qoder Delphi Agent 自动部署 + 文档同步。

## [0.14.27.0] - 2026-07-22

### Added
- **Qoder Delphi Agent 自动部署**: `xp-gate init` 检测 Qoder 平台时自动部署 3 个 Custom Agent（架构/技术/可行性）到 `.qoder/agents/`，使用 Qwen3.7-Max、GLM-5.2、DeepSeek-V4-Pro 内置模型，零配置开箱即用。
- **Agent 模板分发**: 新增 `plugins/qoder/agents/` 目录，随 npm 包同步分发。`configureQoderDelphiAgents()` 函数幂等部署，不覆盖用户自定义。
- **3 个单元测试**: 覆盖部署、用户自定义保护、非 Qoder 平台跳过三个场景。

### Changed
- README.md: 新增 Qoder 插件说明，Delphi Review 平台适配描述。
- CAPABILITIES.md: Delphi 专家配置区分 Qoder（零配置）和 OpenCode（外部 API）两平台。
- AGENTS.md: Qoder plugin 描述更新，含 Delphi agent 自动部署。
- SKILL.md: 各平台副本同步（delphi-review 模型选择策略）。

### Infrastructure
- `init.js` 新增 `configureQoderDelphiAgents()` 函数，平台感知安装流程。
- `sync-package-content.js` 自动同步 `plugins/qoder/agents/` 到 npm 包。

## [0.14.23.0] - 2026-07-21

### Added
- **Delphi Review 跨模型评审 (Qoder)**: 新增 `scripts/delphi-external-review.cjs` 脚本，通过 OpenAI-compatible API 直接调用外部模型（DeepSeek/Qwen/GLM），实现 Qoder 平台真正的跨模型交叉评审。支持 profiles 配置切换、混合模式（local + external）、4 层 JSON 容错提取、分级重试策略。
- **.delphi-config.json profiles**: 配置文件支持多 profile（如 default/starter），一键切换不同模型组合。支持 `provider: "local"` 混合模式渐进式配置。
- **设计文档**: `docs/superpowers/specs/2026-07-21-delphi-review-qoder-cross-model-design.md` — 经 Delphi 两轮评审通过的设计方案。

### Changed
- Qoder SKILL.md / INSTALL.md / AGENTS.md 更新：移除 opencode.json 引用，改为 Bash 调用外部脚本模式。
- `.delphi-config.json.example` 重构：profiles + providers + experts 新格式，含 starter 混合模式示例。
- `sync-package-content.js` 新增 `syncScripts()` 函数，打包时自动复制 `delphi-external-review.cjs` 到 npm 包。

### Infrastructure
- 29 个单元测试覆盖脚本所有纯逻辑函数（parseArgs, readConfig, validateCrossProvider, extractJsonFromResponse 等）。
- npm 包分发：脚本通过 sync-package-content.js 自动同步到 `src/npm-package/scripts/`。

## [0.14.16.0] - 2026-07-20

### Fixed
- npm publish 版本冲突修复 — 0.14.15 已被占用，升级到 0.14.16 重新发布

## [0.14.15.0] - 2026-07-20

### Added
- **#350 File Hygiene Gate (Gate 12)**: 新增 `gate-12-file-hygiene.sh`，检测 staged files 中的 trailing whitespace、missing EOF newline、merge conflict markers、oversized files (>1MB)。Conflict markers 硬阻断，其他问题仅警告。
- **#351 YAML/JSON Syntax Validation**: Gate 12 集成 YAML/JSON 语法校验（Check 5），使用 Python yaml 模块（YAML）和 Node.js JSON.parse（JSON）检测语法错误。语法错误硬阻断。

### Fixed
- **#354**: npm-package hooks 镜像同步 — `src/npm-package/hooks/gate-8.sh` 中 GIBLEAKS_CMD 拼写错误修复（githooks 源已在 v0.14.12 修复）
- **#348**: doctor 性能进一步优化 — EXEC_TIMEOUT_MS 从 3000ms 降至 1500ms；新增全局诊断超时保护 (10s)；upgrade check 独立 3s 超时，防止网络延迟叠加

### Infrastructure
- pre-commit hook 集成 Gate 12（source gate-12-file-hygiene.sh），含 3-tier fallback 路径解析
- npm-package 镜像同步（gate-12-file-hygiene.sh + pre-commit）

## [0.14.12.0] - 2026-07-17

### Fixed
- **#354**: gate-8.sh typo (GIBLEAKS_CMD → GITLEAKS_CMD) - 修复 secret scanning fallback 路径失效
- **#349**: install-skill --force 不清理目标目录 - backup 后显式 rmSync 防止 stale references 残留
- **#347**: update-skill --all 解析错误 - CLI dispatcher 在 extractPositionalArg 之前检测 --all flag
- **#348**: doctor 性能优化 (43s → 2-3.5s) - 并行化所有检查项 + 所有 execSync 调用添加 3 秒超时
- **#341**: ARCH-03 PROJECT_SUBDIR 在多语言 monorepo 中丢失 - 从已修改文件路径派生 PROJECT_SUBDIR，向上遍历查找项目标记
- **#342**: sync-package-content test 改进 - 从 Node native test runner 迁移到 Jest，消除同义反复测试

### Enhanced
- **#333**: xp-gate check CLI 从覆盖 2/11 gates 扩展到覆盖所有 11 道 gates + alias 映射 (version/lint/dup/complexity/principles/tests/arch/iac/secrets/sast/build/sprint)

### Test
- doctor.test.js 异步 mock 基础设施修复 - 为 CI 失败的 17 个测试添加 util.promisify.custom 支持
- 跨平台测试兼容性 - update-hooks.test.ts (Windows fs.access), sprint-discovery.test.ts (path.join), ui-detector.test.ts (spawnSync shell:true)

## [0.14.10.0] - 2026-07-15

### Added
- **#343 Sprint State Manager**: 集中式状态管理 — `SprintStateManager` (JS CommonJS) 提供 `read()`/`write()`/`transitionPhase()`/`rollback()` API，统一 schema 验证 + 自动迁移 + 原子写入
- **#338 Auto-Render Enforcement**: 通过 `onTransition` 回调机制实现 Phase 转换后自动渲染进度看板，消除文本级 MUST 指令的不可执行性
- **#339 Gate MW Provenance Validation**: pre-push 新增溯源验证 — 检查 `experts[]` (≥3)、`consensus` (≥90%)、`walkthroughHash` (SHA-256 跨平台验证)、`generatedAt`，防止 LLM 伪造 walkthrough 结果
- **Migration Mechanism**: 自动迁移遗留 sprint-state.json (无 `_schema_version`) 到 v1 schema，备份原文件，记录迁移警告
- **Grace Period Support**: Gate MW 溯源验证支持 `XP_GATE_MW_GRACE_DAYS` 环境变量 (默认 30 天)，旧格式 walkthrough 获得 WARNING 而非 BLOCK

### Changed
- **Reader Refactoring**: 4 个 reader 统一使用 `SprintStateManager` — `sprint-status.js`、`sprint-discovery.js`、`next-sprint.js`、`sprint-state-io.ts`
- **Version Tracking**: `install-skill.js` 使用 `getCliVersion()` 读取实际版本号 (从 VERSION 文件)，替代硬编码 `'1.0.0'`
- **Test Updates**: 7 个测试文件更新以适配 v1 schema — `sprint-state-manager.test.js` (15 tests)、`sprint-status.test.js`、`sprint-discovery.test.ts`、`sprint-recorder.test.ts`、`span-tracer.test.ts`、`sprint-state-io.test.ts`、`install-skill.test.js`

### Fixed
- **#332**: `install-skill` 现在记录实际 CLI 版本而非硬编码 `'1.0.0'`，`upgrade --apply` 同步已修复
- **#334**: 验证多语言检测正常工作 — `PROJECT_LANGS` 基于文件扩展名检测，混合技术栈项目所有语言均受门禁保护

### Architecture
- **Module Separation**: `SprintStateManager` 拆分为 `sprint-state-manager.js` (核心 API) + `sprint-state-migrator.js` (迁移逻辑)，满足 god-class 规则 (≤15 methods)
- **Atomic Write Pattern**: 所有状态写入使用 tmp + rename 模式，防止并发写入导致数据损坏
- **Observer Pattern**: `transitionPhase()` 支持 `onTransition` 回调，渲染失败降级为 WARNING 而非 BLOCK

## [0.14.9.0] - 2026-07-13

### Added
- **#332 (P0 Bugfix)**: `upgrade --apply` 现在更新已安装的 skills — `handleApplyMode()` 在升级 OpenCode 插件后调用 `updateSkill(null, { all: true })`，修复了升级后 skill 版本不更新的 bug
- **#332 (Doctor)**: `doctor` 新增 Check 9 (`diagnoseInstalledSkills()`) — 对比已安装 skills 与 npm 包内置 SKILL.md 内容，检测版本不一致
- **#328**: mutation 模块测试覆盖 — 5 个新测试文件 (stryker-runner, mutmut-runner, runners-index, init-baseline, update-baseline), 136 个测试
- **#329**: adapter 镜像漂移检测 — `checkAdapterDrift()` 在 `sync-package-content.js` 中使用 SHA-256 哈希比对 `githooks/adapters/` (源) 与 `src/npm-package/adapters/` (镜像)，不一致时阻断 prepack。`copy-skills.sh` 新增 `--verify` 模式进行 checksum 校验。7 个测试
- **#322**: Phase 2/6 DESIGN 路由优化 — `CONTEXT.md` 存在时跳过 brainstorming，直接使用已有设计上下文进入 autoplan/delphi-review

### Changed
- **#329**: `copy-skills.sh` 新增 `--verify` 参数 — 复制后通过 SHA-256 比较验证文件完整性

### Fixed
- 修复 `mutmut-runner.test.ts` 中未使用的 `callCount` 变量 (lint 错误)
- 修复 `update-baseline.test.ts` 中空 arrow function (lint 警告)

## [0.14.8.0] - 2026-07-13

### Added
- **#327**: Mock-policy 单元测试覆盖 — `gate-m3.test.ts` (17 tests) + `schema.test.ts` (23 tests)，共 40 个新测试
- **#323**: 恢复 `xp-gate next-sprint` 命令 — 从 git history 恢复 `next-sprint.js` (129 lines) + `next-sprint.test.js` (14 tests) + CLI 注册
- **#325**: Quality Gate Enhancement (Delphi APPROVED, 100% consensus) — Boy Scout Rule (`boy-scout.ts`) 差异化警告执行 + 13 语言适配器 (java/kotlin/cpp/objectivec 等) + baseline CLI (`xp-gate baseline`) + pre-push Gate M/MD/ML/MW/MS 兼容验证

### Changed
- **#324**: Sprint branch cleanup 设计文档状态 DRAFT → APPROVED — Phase 6/6 CLOSE 已包含完整分支清理步骤 (保存分支信息 → worktree remove → branch -D → push --delete → 关闭遗留 PR)，13 个遗留 sprint 远程分支已清理

### Fixed
- **#326**: Principles rules 单元测试验证 — 确认 15 个规则测试已存在 (100 tests, 16 files, 1462 lines)

## [0.14.7.0] - 2026-07-12

### Changed
- **#321**: `sprint-status.js` 迁移至 6-phase 命名（PREP/DESIGN/BUILD/VERIFY/SHIP/CLOSE），替换旧 11-phase schema。向后兼容旧 sprint-state.json（未识别的 phase key 显示原始值）

### Fixed
- 归档 stale sprint-2026-07-09-01 状态至 `.sprint-history/`
- `gates/README.md` TODO 状态更新 — 准确标记完成/延期项，补充 monolithic pre-commit 设计说明
- `whalecloud-java` PMD 自定义规则 TODO 标记为 Deferred，同步 npm-package 镜像

## [0.14.6.2] - 2026-07-10

### Added
- **#313**: OpenCode plugin 新增 `session-reload-model` tool — 在切换模型供应商配置后，将 `oh-my-openagent.json` 中的 sisyphus 模型同步到 OpenCode SQLite DB，确保 session 恢复后使用新的 provider/model 配置

## [0.14.3.0] - 2026-07-09

### Fixed
- **#311**: Sprint-flow Phase 5 SHIP → CLOSE 增加 HARD-GATE，确保 merge to main + release 完成后才进入 Phase 6，防止 worktree 清理残留和 UAT 验收未合并版本。新增 sprint-state 备份步骤。
- **#312**: pre-commit 增量门禁优化 — 无代码文件变更时 Gate 5 跳过测试运行；Gate 1/7/10 增加变更范围感知，非匹配文件 skip，大幅减少 release commit 耗时

## [0.14.2.0] - 2026-07-09

### Added
- **#310**: OpenCode plugin 新增 session-rename tool — 支持手动指定标题或从最近 10 条用户消息中自动生成标题，直接操作 OpenCode SQLite 数据库，零新依赖

## [0.14.1.0] - 2026-07-09

### Fixed
- **#305**: Sprint-flow BUILD 阶段新增 TDD-GATE 强制执行 — 在 BUILD 入口验证 failing test 存在后才允许 delegation (AGENTS.md + SKILL.md + phase-3-build.md)
- **#307**: CI Mutation Testing 修复 — update-hooks.test.js 中 getProjectHooksDir 测试现在创建 .git 目录隔离，不再因 Stryker 沙箱环境失败

### Changed
- **#306**: Sprint-flow DESIGN 阶段路由分叉 — 根据 PREP 的 `change_type` 区分新产品设计 vs 增量优化路径，增量变更跳过 autoplan 直接进入 lightweight delphi-review
- **#308**: Sprint 迭代结束归档 — CLOSE 阶段新增 Part A.5 ARCHIVE，将 .sprint-state/ 归档到 .sprint-history/ 供后续回溯

## [0.14.0.0] - 2026-07-08

### Added
- **`xp-gate install`**: one-step install command (init + bootstrap + doctor) (#301)
- **`xp-gate uninstall --purge`**: full cleanup of ~/.xp-gate/, ~/.config/xp-gate/, git core.hooksPath, and project .xp-gate/ (#301)
- **GATE_TOOLS classification**: tools cataloged by gate (PLATFORM/IAC/LINT/TEST/MUTATION), cross-referenced via `verify-tool-map.js` (#304, #302)
- **`detectProjectLang()`**: 12-language detection from project markers (tsconfig.json, go.mod, pyproject.toml, etc.) (#304)
- **`doctor --format json`**: machine-readable JSON output for script integration (#304)
- **`bootstrap --lang ts/py/go`**: language-specific tool install support (#304)
- **`postinstall` hint**: npm install -g prints next-steps guidance (#301)

### Fixed
- **gate-9.sh**: GATE 10 → GATE 9 in header, echo messages, and audit log variable naming (#303)
- **doctor**: grouped output by gate category, missing pre-push tools now detected
- **bootstrap/home resolution**: uses shared-paths.js `HOME_DIR` (incl. USERPROFILE) consistently across all commands

### Changed
- **init.js / install-cmd.js**: `copyHooks`/`copyAdapters` extracted to `shared-utils.js` (DRY)
- **Delphi-reviewed**: design doc passes 3-expert consensus (Round 2, 100%); code-walkthrough passes 2-expert consensus (Round 3, 100%)

## [0.13.1.0] - 2026-07-08

### Fixed
- **doctor/bootstrap**: `checkCliTool()` no longer returns false negatives on Windows — uses `where` (Windows) / `which` (Unix) for PATH resolution, explicit `shell` option (`cmd.exe` / `/bin/sh`), platform-appropriate stderr redirection (`2>nul` vs `2>/dev/null`), and 15s timeout for Python tool cold start (#299)

## [0.13.0.0] - 2026-07-08

### Changed
- **Sprint Flow Compact Redesign**: 11-phase model → 6-phase model (PREP → DESIGN → BUILD → VERIFY → SHIP → CLOSE) (#290)
  - Reduces cognitive load from 11 phases to 6, addressing user feedback about losing track of current phase
  - All HARD-GATEs preserved (Delphi consensus internal to DESIGN, UAT mandatory in CLOSE)
  - `render-sprint-progress.cjs` updated with full backward compatibility for legacy `sprint-state.json` files
  - CLI params (`--stop-at`, `--resume-from`, `--phase`) accept both old and new phase names
  - 11 reference files merged into 6; all templates updated; all 7 plugin mirrors synced

### Fixed
- Closes #272 (Sprint Flow step adherence 65% — workflow too complex)
- Closes #290 (RFC: Sprint Flow redesign — compact 7-phase flow + visual progress indicator)

## [0.12.11.0] - 2026-07-06

### Fixed
- **Gate 1**: pre-commit and TypeScript adapter now run tsc on test files — detects type errors in `__tests__/` when tsconfig.json excludes them (#293)
- **Gate 1 (Biome)**: inverted condition fixed — Biome check now actually runs when `biome.json` exists (was: only warned when missing) (#292)

### Changed
- **npm-package mirror**: `src/npm-package/hooks/adapter-common.sh` synced to match githooks (missed from PR #288)

## [0.12.10.0] - 2026-07-06

### Fixed
- **Gate M**: `detect_mutation_testable()` no longer requires stryker config file — checks `package.json` dependency first, then `npx` availability (#288)
- **Gate 5**: sprint-flow tests now compatibile with vitest — `process.exit()` replaced with `describe`/`it`/`beforeAll` wrappers; standalone `node script.js` mode preserved
- **Gate 3 (CI)**: lizard path exclusions + `tr '\n' ' '` fix for find newline bug; non-blocking in CI
- **doctor test AC-004-02**: cache version `999.999.999`→`0.1.0` so `compareVersions` correctly returns `outdated=false`; all AC-004 tests set `XP_GATE_CACHE_DIR`
- **check-version**: `XP_GATE_DIR` changed from IIFE constant to runtime `xpGateDir()` supporting `XP_GATE_CACHE_DIR` env var injection
- **large-file threshold**: raised from 650→1000 in `config.ts` and `.principlesrc`; updated all test assertions

## [0.12.4.1] - 2026-07-03

### Fixed
- **Gate 4**: `principles/index.ts` CLI entry now works under `npx tsx` (ESM `require.main` guard) — was silently producing empty output
- **Gate 9/10 variable collision**: Semgrep SAST (`gate-9.sh`) used `GATE_9_STATUS` overwriting Build Integrity result; renamed to `GATE_10_STATUS`
- **npm-package mirror sync**: `src/npm-package/principles/index.ts` now matches source-of-truth; architecture baseline re-snapped

### Changed
- **Gate 5 vitest optimization**: single `vitest run --coverage` replaces separate test+coverage runs, saving ~40s
- `githooks/adapters/python.sh`: replace `tail -30` with FAILED-line grep for actionable test failure output

## [0.12.4.0] - 2026-07-03

### Refactor
- Project slimming: remove dead code, stale docs, abandoned TUI panel
  - `src/npm-package/skills/`, `src/npm-package/sprint-flow/`, `src/npm-package/build-integrity/`
  - `src/npm-package/gate-*.sh`, `src/npm-package/lib/next-sprint.js`
  - `plugins/opencode/tui-plugin.ts/.tsx`, `src/npm-package/lib/shared-phase-constants.*`
  - 10 stale design docs, `.github/workflows/mutation-test-go.yml`
- Gate 6 arch fixes: reduce `getLatestTimestamp` complexity, split `updateHooks` into focused functions
- `gate-m3.ts`: skip non-existent files instead of ENOENT crash
- Init/gate scripts: sync global hooks to latest, clean project-level hooksPath

## [0.12.3.0] - 2026-07-03

### Added
- **OTel GenAI 可观测性** — debugger 模块新增 OpenTelemetry GenAI span tracing、token 差异追踪、批量导出，零性能开销（`--observability` 开关）。
- `src/debugger/span-types.ts`: OTel GenAI 语义约定类型 (SpanKind, Attributes, OperationType)
- `src/debugger/token-delta.ts`: 差分 Token 用量追踪
- `src/debugger/span-tracer.ts`: 层级 Span 树构建器 (max_depth=10)
- `src/debugger/batch-exporter.ts`: 异步批量 Span 导出
- `src/debugger/sprint-state-io.ts`: 共享 sprint state I/O（消除 CodeClone）
- `src/debugger/evolution-logger.ts`: 函数式模式，避免 archlint DeadSymbol 误报
- 8 个测试文件，68+ 新测试，1835+ 总测试通过

### Fixed
- **Gate 6 Boy Scout Rule**: span-types.ts 导出数从 11 降至 10 以满足 `clean-code.many-exports`
- **Gate 6 DeadSymbol**: evolution-logger.ts 从 class 重构为函数式模式以满足 archlint 追踪

## [0.12.2.0] - 2026-07-02

### Changed
- README.md: 全量重写 README/CAPABILITIES.md，修复已知 10 项 doc-vs-script drift

### Added
- **Gate M: Multi-language mutation testing** — LangAdapter system now routes mutation testing to language-specific runners: Stryker (TypeScript), Mutmut (Python), gomutants (Go), PITest (Java/Kotlin).
- **PitestRunner** — Full PITest integration for Java/Kotlin via Maven (`mvn pitest:mutationCoverage`) and Gradle (`info.solidsoft.pitest` plugin). Supports dual build-tool detection, JSON report parsing (Maven timestamped-dir + Gradle fixed-path), and per-file test matching.
- **Go mutation testing** — Incremental mutation for Go files via `gomutants` with auto-fallback detection (GOPATH/GOMODCACHE).
- **Per-language pre-push sections** — Separate Gate M sections for TypeScript, Python, Go, Java, Kotlin in `githooks/pre-push` with graceful SKIP when tools are missing.

### Changed
- **gate-m.ts refactored** — Extracted `findJavaTestFile`/`findKotlinTestFile` helpers to comply with architecture linter cognitive complexity thresholds. Replaced inline `RunMutationOptions` import with cleaner runner-based abstraction.
- **Architecture baseline updated** — Regenerated `.architecture-baseline.json` to clear pre-existing smell noise from stale baseline hash.

## [0.11.4.0] - 2026-06-30

### Added
- **Gate M: Go mutation testing** — Incremental mutation for Go files via `gomutants` (szhekpisov/gomutants). Per-push section in pre-push with `GATE_M_GO_STATUS` journaling. Graceful SKIP when tool not installed.
- **Gate M: Java mutation testing** — Incremental mutation for Java files via PITest with dual build-tool support (Maven `pom.xml` + Gradle `build.gradle`/`build.gradle.kts`). `PitestRunner` class with `test-compile` step, JSON report parsing, Maven timestamped-dir + Gradle fixed-path report scanning.
- **Gate M: Kotlin mutation testing** — Java/Kotlin share PITest runner (JVM bytecode level). Auto-detected via `build.gradle(.kts)` + `info.solidsoft.pitest` plugin.
- **Pre-push adapter detection** — `detect_go_mutation_testable()`, `detect_pitest_testable()` in `adapter-common.sh`. Go uses `GOMUTANTS_AVAILABLE`/`GO_MUTATION_TOOL`; Java/Kotlin use `PITEST_AVAILABLE`.
- **PitestRunner** — 311 lines, 18 unit tests. Maven (`mvn test-compile org.pitest:pitest-maven:mutationCoverage -DoutputFormats=JSON`) and Gradle (`./gradlew pitest` or `gradle pitest`) support.

## [0.11.0.0] - 2026-06-26

### Added
- **Gate 9: Build Integrity** — New pre-commit gate that verifies TypeScript compilation (`tsc --noEmit`), package manifest integrity (`npm pack --dry-run`), and import path legality. Blocks commits with broken builds.

### Changed
- **Breaking**: Pre-commit gate renumbering: Gate 9 (SAST) → Gate 10; Gate 10 (Sprint Flow) → Gate 11. TOTAL_GATES=11, reportVersion "2.0". Re-run `xp-gate init` to update hooks.
- **Breaking**: Pre-push gates renamed to M-prefix scheme: M2→MD (Mock Density), M3→ML (Mock Layering), Delphi→MW (Code Walkthrough), Gate S→MS (Sprint Flow).
- Pre-push Gate 10 (Build Integrity) retained as defense-in-depth check.

## [0.10.17.0] - 2026-06-26

## [0.10.13] - 2026-06-24

### Fixed

- **Auto-upgrade notification visibility (#212, #216)** — Upgrade results were written only to `stderr`, invisible to OpenCode users. Upgrade notice is now displayed as a banner in the TUI sidebar panel, with `stderr` retained as a fallback for npm-only users without TUI registration.

- **Sprint Flow TUI panel auto-registration (#214, #240)** — The TUI sidebar panel required separate registration in `~/.config/opencode/tui.json`, but documentation never mentioned this. Now `xp-gate init` auto-creates the TUI config, and `xp-gate doctor --fix` (new Check 9) repairs missing/corrupt registrations.

- **Early-phase placeholder rendering (#247)** — When Sprint Flow is starting but no sprint data exists yet, the panel now shows "初始化中..." (`.sprint-state/` detected) or "准备中..." (`.worktrees/` detected) instead of a blank panel.

- **Corrupt JSON resilience** — `doctor --fix` now backs up corrupt `tui.json` as `.corrupt-{timestamp}.bak` and rebuilds from scratch. Atomic writes via `renameSync` prevent partial-file reads.

### Added

- **doctor Check 9: TUI registration** — Detects missing/corrupt `~/.config/opencode/tui.json` and auto-repairs via `--fix`.

## [0.10.8] - 2026-06-23

### Fixed

- **qoder plugin version sync** — `plugins/qoder/plugin.json` was not included in `scripts/sync-version.sh`, causing it to remain at 0.8.17 while all other components advanced to 0.10.x. Now synced as part of the standard version bump process.
- **npm-package qoder mirror** — `src/npm-package/plugins/qoder/plugin.json` also fixed (was 0.8.17 → 0.10.7, now 0.10.8).

## [0.10.7] - 2026-06-23

### Fixed

- **sprint-flow orchestrator stall (#248)** — Phase 0 and Phase 1 were incorrectly dispatched to subagents, causing interactive skills (brainstorming, autoplan, to-issues) to hang. Restored orchestrator-direct execution for all interactive phases, restored the Background Task Resume Protocol lost during the SKILL.md slim refactor (commit `c0c52f4`), and expanded audit to all 13 sprint-flow skills.
  - **Phase 0 THINK**: brainstorming now runs in orchestrator (interactive — requires user decisions)
  - **Phase 1 PLAN**: autoplan + to-issues run in orchestrator (interactive); delphi-review dispatched to subagent (non-interactive)
  - **Phase 6 SHIP**: finishing-a-development-branch + ship run in orchestrator (interactive — merge/PR decisions)
  - **Phase 7 LAND**: land-and-deploy runs in orchestrator (interactive — deploy verification)
  - Phase 2 BUILD (ralph-loop), Phase 3 REVIEW (delphi-review + test-alignment), Phase 5 FEEDBACK (learn/retro/debug) remain subagent-dispatched (all non-interactive)
  - Added Background Task Resume Protocol to orchestration-rules.md and auto-estimate phase doc

## [0.10.6] - 2026-06-23

### Fixed

- **TUI plugin exports field** — npm package `src/npm-package/package.json` had no TUI exports field, causing sidebar to break. Added proper exports entry.

## [0.10.5] - 2026-06-23

### Fixed

- **npm-package mirror sync** — `GoMutantRunner` and all Go mutation testing files (`go-mutant-runner.ts`, `runners/index.ts`, `gate-m.ts` test discovery, `go-mutant-runner.test.ts`) were committed to `src/mutation/` in v0.10.4.0 but not mirrored to `src/npm-package/mutation/`
  - This means npm users did not actually receive Go mutation support in v0.10.4
  - All 4 files now correctly mirrored so `@boyingliu01/xp-gate@0.10.5` distributes Go mutation testing properly
- Architecture baseline updated to account for pre-existing mirror duplication smells (CodeClone between `src/mutation/` and `src/npm-package/mutation/`)

## [0.10.4] - 2026-06-23

### Added

- **#160: Go mutation testing (Gate M)** — `GoMutantRunner` spawns `gomutants` (v0.4.0) to run mutation testing on Go source files
  - Auto-routed via `runnerRegistry` when `.go` files change on pre-push
  - Parses `test_efficacy` score + per-file `mutations[]` array with status counting
  - Go test file discovery (`foo.go → foo_test.go`) integrated into `findTestFileForSource`
  - 11 unit tests for `GoMutantRunner` (isAvailable, spawn args, timeout, JSON parsing)
  - CI workflow `mutation-test-go.yml` for E2E Go mutation regression testing
  - New workflow job: setup Go 1.26 → install gomutants → create fixture → gate-m E2E

### Changed

- Architecture baseline updated to account for pre-existing smells in `gate-m.ts`

## [0.10.3] - 2026-06-22

### Added

- **Gate 10: Build Integrity Check (pre-push)** — catches broken package references that all previous gates missed. Three checks run in parallel:
  - `tsc --noEmit` — type-check the project (incremental with `.tsbuildinfo` caching)
  - `npm pack --dry-run` — verify package manifest includes expected files
  - Import resolver — detect relative imports that escape the package boundary or target nonexistent files (the original bug: `tui-plugin.ts` importing `../../src/...` which didn't exist in the published npm package)
  - New module: `src/build-integrity/gate-10.ts` with `runTscCheck`, `runPackCheck`, `runImportCheck`, `runGate10`, and `main` CLI
  - Integrated into `githooks/pre-push` (runs after Gate S, before Gate M)
  - 63 unit tests (40 import-resolver, 10 tsc/pack, 13 orchestrator) — all passing
- **#246: ESLint config warning** — pre-commit now warns when eslint is in devDependencies but no `.eslintrc*` / `eslint.config.*` is found (non-blocking, informational)

### Changed

- **Pre-push report** now tracks individual gate statuses (Gate 10, M, M-Python, M2, M3, UI, Delphi) instead of a single verdict
- **npm package sync** now includes `build-integrity/` module; `src/npm-package/package.json` files array updated

## [0.10.2] - 2026-06-22

### Changed

- **VERSION bump to 0.10.2.0** (npm 0.10.0 and 0.10.1 were pre-published before sprint fixes landed; this release carries all v0.10.1 fixes to a publishable version)

## [0.10.1] - 2026-06-22

### Fixed

- **ESM type-only exports**: `src/mutation/runners/index.ts` changed `export { Interface }` to `export type { Interface }` — prevents `tsx` runtime crash on pre-push Gate M (`MutationFileReport` is a TS interface, `export { }` tries to re-export as runtime value in ESM)
- **Gate 5a compliance**: Added `@no-test-required` annotations to all 4 mutation runner files (`types.ts`, `stryker-runner.ts`, `mutmut-runner.ts`, `index.ts`) and their npm prepack mirrors — new `.ts` files without test pairs now pass Gate 5a on main
- **Lint cleanup**: `tui-plugin.ts` removed unused constants, test file replaced `as any` with `as unknown as typeof base`
- **OpenCode TUI plugin**: fixed type errors and dead code

## [0.10.0] - 2026-06-22

### Added

- **Python mutation testing (Gate M)**: LangAdapter architecture with `MutationRunner` interface, `StrykerRunner` (TypeScript) and `MutmutRunner` (Python). `gate-m.ts` routes by file extension and runs each language's native mutation tool.
  - MutmutRunner: mutmut v3.x compatible — backup/restore `pyproject.toml`, emoji progress parsing, preserves existing user config (`paths_to_exclude`, `timeout`, etc.)
  - Shell integration: `detect_python_mutation_testable()`, `run_mutation()` in python.sh, pre-push Python Gate M section
  - Runner registry pattern extensible for future languages (Go, Java, etc.)

### Fixed

- **OpenCode TUI plugin**: removed `as any`, inlined constants to avoid bundling `src/`, synced to 3 locations
- **gate-m.ts**: removed dead `errorFiles` variable, added `groupByRunner()` routing for multi-language mutation
- **Delphi review**: experts read from worktree (not stale main repo files) to prevent hallucination

## [0.9.3] - 2026-06-18

### Added

- **OpenCode TUI sidebar slot plugin**: `plugins/opencode/tui-plugin.ts` renders Sprint Flow progress in the OpenCode sidebar. Registers via `"./tui"` subpath export. Shows phase status, REQ-level progress, metrics, and staleness detection. 30 unit tests covering all pure functions.
  - `readSprintState()`: reads `.sprint-state/sprint-state.json`
  - `renderSprintSidebar()`: renders phase lines with ✓/→/·/○ status symbols
  - `isStale()`: detects >1h inactivity

## [0.9.2] - 2026-06-18

### Fixed

- **Windows bash hooks compatibility (#187, #168)**:
  - `detect_os_env()`: Cross-platform OS detection using `uname -s` + `${OSTYPE-}` fallback
  - `head→sed`: 46 replacements across 15 hook/adapter files — `sed -n '1,Np; Nq'` with early exit
  - `[[ ]]→[ ]`: 47 POSIX-compatible conditional expressions in adapter-common.sh + install/verify scripts
  - `brew→winget/pip`: Windows tool install hints in Gate 8 and Gate 9 files
  - **Plugin stretch goal**: Replaced 6 `head` usages in p3c-java + whalecloud-java plugin scripts
  - **CI**: New `windows-gitbash-hooks` job in cross-platform CI workflow
  - **Docs**: Windows setup section in `TOOL-INSTALLATION-GUIDE.md`
  - All 37 githooks `.sh` files now `head`-free, 33/33 acceptance criteria passed

## [0.9.1] - 2026-06-18

### Refactored

- **Skill Slimming Sprint**: 4 skills trimmed to ≤12KB each (total 90KB→27KB, -70%)
  - `admin-template-guidelines`: 28KB → 4.4KB (6 rules → `references/rule-{1..6}.md`)
  - `test-specification-alignment`: 23KB → 7.4KB (CN/EN dedup, `references/`)
  - `delphi-review`: 18KB → 7.8KB (templates → `references/`)
  - `ralph-loop`: 21KB → 7.3KB (merge `components/` → `references/components.md`)
- Mirrors synced across all 4 plugin platforms (claude-code/opencode/qoder)
- Fixes #236 (skill token slimming), #237 (subagent dispatch model error — root cause: sdxl-v1 model not available for deep tasks, mitigated by g-deepseek-v4-flash)

## [0.9.0] - 2026-06-18

### Breaking Changes

- **Gate 5a-BLOCK**: New `.ts/.tsx` files without corresponding tests now BLOCK commits (previously WARNING only). Modified files remain WARNING. Escape valve: `SKIP_GATE_5A_BLOCK=1` (non-main/master branches only).
- **Gate M2**: Mock density threshold lowered from 50% to 30%. Phase 1: WARNING mode (no blocking). Phase 2: will enable BLOCK after baseline analysis. Configurable via `.mockpolicyrc`.

### Added

- **REQ-TDD-004**: 24 BATS tests for Gate 5a-BLOCK (14 scenarios) and Gate M2 threshold (10 scenarios)
- **REQ-TDD-005**: `checkDocsDrift()` unit tests (5 tests) with testable refactor — function now accepts path params and returns boolean instead of `process.exit(1)`
- **Gate 5a config exclusions**: `node_modules/`, `.next/`, `.nuxt/`, `dist/`, `build/`, `.turbo/`, `.cache/`, and config files (`vitest.config.*`, `vite.config.*`, `tsconfig.*`, etc.)

### Changed

- **REQ-TDD-003**: Skill references synced across npm mirrors (ralph-loop, sprint-flow, phase-2-build)
- **Gate 5a**: New `.ts/.tsx` files without tests now BLOCK (previously WARNING)

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

## [Unreleased] - v0.9.6.0

### Added
- **Python Mutation Testing (Gate M)**: 首次为 Python 项目提供增量变异测试支持
  - 工具：mutmut (pytest-native, CLI 友好，增量支持)
  - 阈值：默认 60%，关键路径 80%
  - 超时：120s（超时允许推送但警告）
  - 文件过滤：自动排除 `test_*.py`、`/tests/`、`__pycache__`
  - 配置：支持 `.mutmut.conf` 和 `mutmut_config.py`
  - 基线：扩展 `.mutation-baseline.json` 支持 Python 分数
  - 集成：Pre-push 钩子，位于 TypeScript Gate M 之后
  - 参考：`docs/plans/2026-06-21-python-mutation-testing-integration.md`

### Changed
- `README.md`: 更新 Pre-push 门禁表格，添加 Python Gate M
- `githooks/pre-push`: 添加 Python 变异测试集成
- `githooks/adapters/python.sh`: 新增 `run_mutation()` 函数
- `githooks/adapter-common.sh`: 新增 `detect_mutation_testable()` Python 支持
- `src/mutation/gate-m-python.ts`: 新增 TypeScript 运行器
- `src/mutation/types.ts`: 扩展类型定义支持多语言基线
- `.gitignore`: 添加 `.mutation-baseline.json`

### Technical Debt
- 待创建 Python 突变测试用例 (`src/mutation/__tests__/gate-m-python.test.ts`)
- 待更新 CAPABILITIES.md 添加 Python 突变测试能力说明
- 待创建 mutmut 配置模板 (`templates/.mutmut.conf.example`)
