# Changelog

All notable changes to this project will be documented in this file.

## [0.5.1] - 2026-05-30

### Added
- **REQ-1: xp-gate uninstall CLI** — 完整卸载命令，镜像反转 init，支持 dry-run/force 参数，manifest 文件跟踪
- **REQ-2: xp-gate doctor CLI** — 诊断命令，检查 config/hooks/adapters/core.hooksPath/env，支持 --fix 自动修复
- **REQ-3: xp-gate migrate CLI** — v0.4.x 迁移助手，自动清理 ~/.npmrc GitHub Packages PAT 残留
- **REQ-5: Windows 兼容验证** — CI matrix 添加 windows-latest runner，Node 18/20/22 LTS 全部通过

## [Unreleased]

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
- **Delphi Review System**: Multi-expert consensus (≥95% threshold)
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
